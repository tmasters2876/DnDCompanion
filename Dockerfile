# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY app app
RUN npm run build -w app

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace=dnd-companion-server --include-workspace-root=false \
  && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ARG APP_RELEASE=development
ARG BUILD_DATE=development
ARG DATA_DIGEST=development
LABEL org.opencontainers.image.title="Dungeon Master's Companion" \
  org.opencontainers.image.revision="$APP_RELEASE" \
  org.opencontainers.image.created="$BUILD_DATE"
ENV NODE_ENV=production \
  PORT=5177 \
  APP_RELEASE=$APP_RELEASE \
  BUILD_DATE=$BUILD_DATE \
  DATA_DIGEST=$DATA_DIGEST
WORKDIR /app
COPY package.json ./
COPY --from=production-dependencies /app/node_modules node_modules
COPY server server
COPY --from=build /app/app/dist app/dist
RUN mkdir -p data/srd data/sources/_normalized data/characters data/homebrew \
  && chown -R 1026:100 /app/data
USER 1026:100
EXPOSE 5177
HEALTHCHECK --interval=30s --timeout=5s --start-period=75s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5177/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server/index.mjs"]
