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
# The credential belongs to the host account that logged Codex in, and a
# ChatGPT-mode refresh token is single-use: whoever spends it must be able to
# write the replacement back. Mounting that file straight in as read-only left
# the parser unable to read it (wrong owner) and unable to persist a refresh
# (read-only root), so Codex failed on the first document. The parser instead
# runs as the credential's owner and keeps its own writable copy in a
# persistent CODEX_HOME, seeded once from the read-only original — the same
# arrangement the costs agents already run on.
ARG CODEX_UID=1001
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates poppler-utils \
  && npm install --global "@openai/codex@${CODEX_VERSION}" \
  && mkdir -p /data/codex \
  && chown -R "${CODEX_UID}:${CODEX_UID}" /data \
  && chmod 700 /data/codex \
  && rm -rf /var/lib/apt/lists/* /root/.npm
WORKDIR /opt/invoice-parser
COPY scripts/invoice-agent/parser-server.mjs ./parser-server.mjs
COPY scripts/invoice-agent/prompt.md ./prompt.md
COPY scripts/invoice-agent/output.schema.json ./output.schema.json
ENV CODEX_HOME=/data/codex
ENV CODEX_SEED_AUTH_FILE=/run/codex-seed/auth.json
USER 1001:1001
# Seeding copies rather than links: from here the parser owns its session, so a
# refreshed token cannot invalidate the one the host CLI still holds.
CMD ["sh", "-c", "if [ -r \"$CODEX_SEED_AUTH_FILE\" ] && [ ! -f \"$CODEX_HOME/auth.json\" ]; then cp \"$CODEX_SEED_AUTH_FILE\" \"$CODEX_HOME/auth.json\" && chmod 600 \"$CODEX_HOME/auth.json\"; fi; exec node parser-server.mjs"]

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
