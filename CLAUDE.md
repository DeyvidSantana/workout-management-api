# CLAUDE.md

Este arquivo fornece orientações ao Claude Code (claude.ai/code) ao trabalhar com o código neste repositório.

## Comandos

```bash
# Iniciar servidor de desenvolvimento (hot reload via tsx)
pnpm dev

# Iniciar banco de dados (PostgreSQL via Docker)
docker compose up -d

# Migrações do Prisma
pnpm prisma migrate dev        # Cria e aplica uma nova migration
pnpm prisma migrate deploy     # Aplica migrations pendentes (produção)
pnpm prisma generate           # Regenera o Prisma Client após mudanças no schema

# Gerar schema do better-auth (executar quando os models de auth mudarem)
pnpm dlx @better-auth/cli generate

# Lint
pnpm eslint .

# Formatação
pnpm prettier --write .
```

Nenhuma suite de testes está configurada ainda (o script `test` é um placeholder).

## Arquitetura

**Stack**: Fastify 5 + Zod + Prisma 7 (PostgreSQL) + better-auth, tudo em TypeScript ESM.

### Ponto de entrada (`src/index.ts`)

Configura a aplicação Fastify com:

- `fastify-type-provider-zod` para validação de requisição/resposta e inferência de tipos baseada em Zod
- `@fastify/swagger` + `@scalar/fastify-api-reference` para documentação da API em `/docs`
- `@fastify/cors` permitindo `http://localhost:3000`
- Um handler de bridge em `/api/auth/*` que adapta o request/reply do Fastify para a Fetch API esperada pelo better-auth

### Autenticação (`src/lib/auth.ts`)

Usa **better-auth** com email/senha habilitado e um adapter Prisma (via `@prisma/adapter-pg`). O handler de auth é compatível com a Fetch API e é integrado ao Fastify manualmente. O plugin `openAPI()` expõe os schemas de auth em `/api/auth/open-api/generate-schema`, que é vinculado na documentação Scalar.

### Banco de dados (`prisma/schema.prisma`)

PostgreSQL. O Prisma Client é gerado em **`src/generated/prisma/`** (não no local padrão). Sempre importe de `../generated/prisma/client.js` (ou o caminho relativo apropriado).

Models de domínio com exclusão em cascata:

- `User` → `WorkoutPlan` → `WorkoutDay` → `WorkoutExercise`
- `WorkoutDay` → `WorkoutSession`

Os models do better-auth (`Session`, `Account`, `Verification`) são mapeados para nomes de tabelas em minúsculas.

### Configuração do Prisma (`prisma.config.ts`)

Usa `dotenv/config` para carregar variáveis de ambiente. O caminho do schema é `prisma/schema.prisma`.

### Variáveis de ambiente (`.env`)

```
PORT=8081
DATABASE_URL=postgresql://postgres:password@localhost:5432/workout-management-api
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:8081
```

### ESLint

`eslint-plugin-simple-import-sort` impõe imports ordenados. `eslint-config-prettier` desabilita regras de formatação que conflitam com o Prettier. Execute ambos antes de fazer commit.

## Convenções importantes

- O projeto é **exclusivamente ESM** (`"type": "module"`); todos os imports precisam de extensões `.js` em tempo de execução (o TypeScript resolve corretamente com `moduleResolution: nodenext`).
- Use `app.withTypeProvider<ZodTypeProvider>().route(...)` em todas as rotas tipadas para que os schemas Zod controlem tanto a validação quanto os tipos TypeScript.
- O Prisma Client usa `@prisma/adapter-pg` (modo driver-adapters), portanto instancie-o com `new PrismaPg({ connectionString })`.
- Após modificar `prisma/schema.prisma`, sempre execute `pnpm prisma migrate dev` **e** `pnpm prisma generate` para manter `src/generated/prisma/` sincronizado.
