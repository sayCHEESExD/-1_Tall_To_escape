# The Colyseus server.
#
# Built from the REPOSITORY ROOT: this is an npm workspaces monorepo and the
# server imports `@highjump/shared` as a workspace dependency.
#
#   docker build -t tall-to-escape-server .
#   docker run -e PORT=2571 -p 2571:2571 tall-to-escape-server
#
# Bloxity Legion injects PORT (and NODE_ENV) at deploy time; the server reads it
# and serves GET /health on the same port. It runs as the non-root `node` user.

# ---------------------------------------------------------------- build ----
FROM node:20-alpine AS build
WORKDIR /app

# Every workspace manifest is needed: npm resolves the whole tree in one pass.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY shared/ shared/
COPY server/ server/
RUN npm run build:server
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 0.0.0.0 inside a container; PORT is left to the host (falls back to 2571).
ENV HOST=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist

# Profiles are a JSON file. Mount a volume here or a redeploy wipes progression.
ENV HIGHJUMP_DATA_DIR=/data
VOLUME ["/data"]
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 2571
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2571)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Straight to node: npm swallows SIGTERM, which flushes player profiles.
CMD ["node", "server/dist/index.js"]
