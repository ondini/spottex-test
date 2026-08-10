FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM builder AS migrator
ENV NODE_ENV=production
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/grant-db-role.ts"]

FROM builder AS analysis-worker
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
USER node
CMD ["node", "--conditions=react-server", "--import", "tsx", "scripts/analysis-worker.ts"]

FROM builder AS invoice-coordinator
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
USER node
CMD ["node", "--conditions=react-server", "--import", "tsx", "scripts/invoice-agent/coordinator.ts"]

FROM node:22-bookworm-slim AS invoice-parser
ARG CODEX_VERSION=0.146.0-alpha.9.2
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates poppler-utils \
  && npm install --global "@openai/codex@${CODEX_VERSION}" \
  && mkdir -p /home/node/.codex \
  && chown node:node /home/node/.codex \
  && rm -rf /var/lib/apt/lists/* /root/.npm
WORKDIR /opt/invoice-parser
COPY --chown=node:node scripts/invoice-agent/parser-server.mjs ./parser-server.mjs
COPY --chown=node:node scripts/invoice-agent/prompt.md ./prompt.md
COPY --chown=node:node scripts/invoice-agent/output.schema.json ./output.schema.json
USER node
CMD ["node", "parser-server.mjs"]

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3004
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/env-runtime.mjs ./env-runtime.mjs
USER nextjs
EXPOSE 3004
CMD ["sh", "-c", "node env-runtime.mjs && exec node server.js"]
