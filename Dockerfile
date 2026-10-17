# syntax=docker/dockerfile:1

FROM node:26.12.0-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4 AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml vite.config.ts tsconfig.json ./
RUN npm install --global "pnpm@$(node -p "require('./package.json').devEngines.packageManager.version")" \
    && pnpm config set store-dir /pnpm/store
RUN --mount=type=cache,target=/pnpm/store VP_GIT_HOOKS=0 pnpm install --frozen-lockfile
COPY src ./src
COPY docs ./docs
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:26.12.0-trixie-slim@sha256:0d1e33586362bb9e608c4e751e7a9e7edb55c9ac11461ed5666af696cc461dd4
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/docs ./docs
USER node
EXPOSE 8002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8002/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/http.mjs"]
