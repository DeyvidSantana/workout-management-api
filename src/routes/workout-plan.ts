import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  WorkoutPlanNotActiveError,
} from "../errors/index.js";
import { auth } from "../lib/auth.js";
import {
  ErroSchema,
  UpdatedWorkoutSessionSchema,
  UpdateWorkoutSessionBodySchema,
  WorkoutPlanSchema,
  WorkoutSessionSchema,
} from "../schemas/index.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { StartWorkoutSession } from "../usecases/StartWorkoutSession.js";
import { UpdateWorkoutSession } from "../usecases/UpdateWorkoutSession.js";

export const workoutPlanRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      tags: ["Workout Plan"],
      summary: "Create a workout plan",
      body: WorkoutPlanSchema.omit({ id: true }),
      response: {
        201: WorkoutPlanSchema,
        400: ErroSchema,
        401: ErroSchema,
        404: ErroSchema,
        500: ErroSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const createWorkoutPlan = new CreateWorkoutPlan();
        const result = await createWorkoutPlan.execute({
          userId: session.user.id,
          name: request.body.name,
          workoutDays: request.body.workoutDays,
        });
        return reply.status(201).send(result);
      } catch (error) {
        app.log.error(error);

        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        return reply.status(500).send({
          error: "Internal Server Error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/:workoutPlanId/days/:workoutDayId/sessions",
    schema: {
      tags: ["Workout Session"],
      summary: "Start a workout session",
      params: z.object({
        workoutPlanId: z.uuid(),
        workoutDayId: z.uuid(),
      }),
      response: {
        201: WorkoutSessionSchema,
        400: ErroSchema,
        401: ErroSchema,
        403: ErroSchema,
        404: ErroSchema,
        409: ErroSchema,
        500: ErroSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const startWorkoutSession = new StartWorkoutSession();
        const result = await startWorkoutSession.execute({
          userId: session.user.id,
          workoutPlanId: request.params.workoutPlanId,
          workoutDayId: request.params.workoutDayId,
        });
        return reply.status(201).send(result);
      } catch (error) {
        app.log.error(error);

        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof ForbiddenError) {
          return reply.status(403).send({
            error: error.message,
            code: "FORBIDDEN",
          });
        }

        if (error instanceof WorkoutPlanNotActiveError) {
          return reply.status(400).send({
            error: error.message,
            code: "WORKOUT_PLAN_NOT_ACTIVE",
          });
        }

        if (error instanceof ConflictError) {
          return reply.status(409).send({
            error: error.message,
            code: "CONFLICT",
          });
        }

        return reply.status(500).send({
          error: "Internal Server Error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: "PATCH",
    url: "/:workoutPlanId/days/:workoutDayId/sessions/:sessionId",
    schema: {
      tags: ["Workout Session"],
      summary: "Update a workout session",
      params: z.object({
        workoutPlanId: z.uuid(),
        workoutDayId: z.uuid(),
        sessionId: z.uuid(),
      }),
      body: UpdateWorkoutSessionBodySchema,
      response: {
        200: UpdatedWorkoutSessionSchema,
        401: ErroSchema,
        403: ErroSchema,
        404: ErroSchema,
        500: ErroSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(request.headers),
        });
        if (!session) {
          return reply.status(401).send({
            error: "Unauthorized",
            code: "UNAUTHORIZED",
          });
        }

        const updateWorkoutSession = new UpdateWorkoutSession();
        const result = await updateWorkoutSession.execute({
          userId: session.user.id,
          workoutPlanId: request.params.workoutPlanId,
          workoutDayId: request.params.workoutDayId,
          sessionId: request.params.sessionId,
          completedAt: request.body.completedAt,
        });
        return reply.status(200).send(result);
      } catch (error) {
        app.log.error(error);

        if (error instanceof NotFoundError) {
          return reply.status(404).send({
            error: error.message,
            code: "NOT_FOUND",
          });
        }

        if (error instanceof ForbiddenError) {
          return reply.status(403).send({
            error: error.message,
            code: "FORBIDDEN",
          });
        }

        return reply.status(500).send({
          error: "Internal Server Error",
          code: "INTERNAL_SERVER_ERROR",
        });
      }
    },
  });
};
