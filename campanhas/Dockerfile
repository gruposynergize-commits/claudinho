# syntax=docker/dockerfile:1.7
# Imagens:
#   --target app    → servidor Next.js (standalone), usuário sem privilégios
#   --target tools  → migrações, seed, criação de admin e worker de rotinas
# Imagem base configurável (ex.: espelho do Docker Hub): --build-arg NODE_IMAGE=...
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# Opcional, para redes com proxy TLS: docker build --secret id=npm_ca,src=ca.pem
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx next build

# Ferramentas de operação (prisma CLI, tsx): migrate deploy, seed, create-admin, worker.
FROM build AS tools
ENV NODE_ENV=production
RUN chown -R node:node /app
USER node
# Sem npm como PID 1: o sinal de parada chega ao worker (encerramento limpo).
CMD ["node_modules/.bin/tsx", "--conditions=react-server", "scripts/worker.ts"]

FROM ${NODE_IMAGE} AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
