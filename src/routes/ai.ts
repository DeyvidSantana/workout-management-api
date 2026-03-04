import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  UIMessage,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { GetWorkoutPlans } from "../usecases/GetWorkoutPlans.js";
import { UpsertUserTrainData } from "../usecases/UpsertUserTrainData.js";

const SYSTEM_PROMPT = `
Você é um personal trainer virtual especialista em montagem de planos de treino.

**Regras gerais:**
- Tom amigável, motivador, linguagem simples, sem jargões técnicos. Seu público são pessoas leigas em musculação.
- **SEMPRE** chame a tool \`getUserTrainData\` antes de qualquer interação com o usuário.
- Se o usuário **não tem dados cadastrados** (retornou null): pergunte nome, peso (kg), altura (cm), idade e % de gordura corporal em uma única mensagem simples e direta. Após receber, salve com \`updateUserTrainData\` (converta peso de kg para gramas multiplicando por 1000).
- Se o usuário **já tem dados**: cumprimente pelo nome de forma motivadora.
- Para **criar um plano de treino**: pergunte objetivo, dias disponíveis por semana e restrições físicas/lesões em uma única mensagem. Depois crie o plano com \`createWorkoutPlan\`.
- O plano DEVE ter exatamente 7 dias (MONDAY a SUNDAY). Dias sem treino: \`isRest: true\`, \`workoutExercises: []\`, \`estimatedDurationInSeconds: 0\`.
- Respostas curtas e objetivas.

**Divisões de Treino (Splits) — escolha conforme os dias disponíveis:**
- 2-3 dias/semana: Full Body ou ABC (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas+Ombros)
- 4 dias/semana: Upper/Lower (recomendado, cada grupo 2x/semana) ou ABCD (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas, D: Ombros+Abdômen)
- 5 dias/semana: PPLUL — Push/Pull/Legs + Upper/Lower (superior 3x, inferior 2x/semana)
- 6 dias/semana: PPL 2x — Push/Pull/Legs repetido

**Princípios de montagem:**
- Músculos sinérgicos juntos (peito+tríceps, costas+bíceps)
- Exercícios compostos primeiro, isoladores depois
- 4 a 8 exercícios por sessão
- 3-4 séries por exercício: 8-12 reps (hipertrofia), 4-6 reps (força)
- Descanso entre séries: 60-90s (hipertrofia), 2-3min (compostos pesados)
- Evitar treinar o mesmo grupo muscular em dias consecutivos
- Nomes descritivos para cada dia (ex: "Superior A - Peito e Tríceps", "Descanso")

**Imagens de capa (coverImageUrl) — OBRIGATÓRIO fornecer para cada dia:**
- Dias superiores (peito, costas, ombros, bíceps, tríceps, push, pull, upper, full body) e dias de descanso:
  - https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO3y8pQ6GBg8iqe9pP2JrHjwd1nfKtVSQskI0v
  - https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOW3fJmqZe4yoUcwvRPQa8kmFprzNiC30hqftL
- Dias inferiores (pernas, glúteos, quadríceps, posterior, panturrilha, legs, lower):
  - https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOgCHaUgNGronCvXmSzAMs1N3KgLdE5yHT6Ykj
  - https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO85RVu3morROwZk5NPhs1jzH7X8TyEvLUCGxY
- Alterne entre as duas opções de cada categoria para variar.
`.trim();

export const aiRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      tags: ["AI"],
      summary: "Chat with AI personal trainer",
      body: z.object({
        messages: z.array(z.record(z.string(), z.unknown())),
      }),
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        return reply
          .status(401)
          .send({ error: "Unauthorized", code: "UNAUTHORIZED" });
      }

      const userId = session.user.id;
      const { messages } = request.body;

      const result = streamText({
        model: openai("gpt-4o-mini"),
        system: SYSTEM_PROMPT,
        tools: {
          getUserTrainData: tool({
            description: "Busca os dados de treino do usuário autenticado",
            inputSchema: z.object({}),
            execute: async () => {
              const getUserTrainData = new GetUserTrainData();
              return getUserTrainData.execute({ userId });
            },
          }),
          updateUserTrainData: tool({
            description:
              "Salva ou atualiza os dados físicos do usuário autenticado",
            inputSchema: z.object({
              weightInGrams: z
                .number()
                .int()
                .min(0)
                .describe("Peso em gramas (ex: 70kg = 70000)"),
              heightInCentimeters: z
                .number()
                .int()
                .min(0)
                .describe("Altura em centímetros"),
              age: z.number().int().min(0).describe("Idade em anos"),
              bodyFatPercentage: z
                .number()
                .int()
                .min(0)
                .max(100)
                .describe(
                  "Percentual de gordura corporal (0 a 100, onde 100 = 100%)",
                ),
            }),
            execute: async (input) => {
              const upsertUserTrainData = new UpsertUserTrainData();
              return upsertUserTrainData.execute({ userId, ...input });
            },
          }),
          getWorkoutPlans: tool({
            description: "Lista os planos de treino do usuário autenticado",
            inputSchema: z.object({}),
            execute: async () => {
              const getWorkoutPlans = new GetWorkoutPlans();
              return getWorkoutPlans.execute({ userId });
            },
          }),
          createWorkoutPlan: tool({
            description:
              "Cria um novo plano de treino completo com exatamente 7 dias",
            inputSchema: z.object({
              name: z.string().describe("Nome do plano de treino"),
              workoutDays: z
                .array(
                  z.object({
                    name: z
                      .string()
                      .describe(
                        "Nome do dia (ex: Superior A - Peito e Tríceps, Descanso)",
                      ),
                    weekDay: z.enum(WeekDay).describe("Dia da semana"),
                    isRest: z
                      .boolean()
                      .describe(
                        "Se é dia de descanso (true) ou treino (false)",
                      ),
                    estimatedDurationInSeconds: z
                      .number()
                      .describe(
                        "Duração estimada em segundos (0 para dias de descanso)",
                      ),
                    coverImageUrl: z
                      .url()
                      .describe(
                        "URL da imagem de capa do dia. Usar URLs de superior para dias superiores/descanso e URLs de inferior para dias inferiores.",
                      ),
                    workoutExercises: z
                      .array(
                        z.object({
                          order: z
                            .number()
                            .describe("Ordem do exercício no dia"),
                          name: z.string().describe("Nome do exercício"),
                          sets: z.number().describe("Número de séries"),
                          reps: z.number().describe("Número de repetições"),
                          restTimeInSeconds: z
                            .number()
                            .describe(
                              "Tempo de descanso entre séries em segundos",
                            ),
                        }),
                      )
                      .describe(
                        "Lista de exercícios (vazia para dias de descanso)",
                      ),
                  }),
                )
                .describe(
                  "Array com exatamente 7 dias de treino (MONDAY a SUNDAY)",
                ),
            }),
            execute: async (input) => {
              const createWorkoutPlan = new CreateWorkoutPlan();
              return createWorkoutPlan.execute({ userId, ...input });
            },
          }),
        },
        stopWhen: stepCountIs(5),
        messages: await convertToModelMessages(
          messages as unknown as UIMessage[],
        ),
      });

      const response = result.toUIMessageStreamResponse();
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body);
    },
  });
};
