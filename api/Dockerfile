# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Hydra self-hosted API — hardened multi-stage build.
#
#   * build stage carries the C toolchain (better-sqlite3 is a native module);
#     the runtime image does not, so a compiler is never shipped to the server.
#   * runtime runs as uid 1000 (`node`), never as root.
#   * /data is the only writable path — see compose (read_only rootfs + tmpfs).
# ---------------------------------------------------------------------------

FROM node:22-alpine3.22 AS build

WORKDIR /app

# python3/make/g++ are needed only to compile better-sqlite3.
RUN apk add --no-cache python3 make g++

# Copy manifests first so the dependency layer is cached independently of src.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

# Compile TS, then drop devDependencies from the tree we are about to ship.
RUN npx tsc \
 && npm prune --omit=dev \
 && npm cache clean --force

# ---------------------------------------------------------------------------

FROM node:22-alpine3.22 AS runtime

# tini reaps zombies and forwards SIGTERM, so `docker compose down` is clean.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app

# Application files stay root-owned: the process (uid 1000) can read but not
# rewrite its own code, even if the rootfs were mounted writable.
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json ./

# Ownership here is what Docker copies onto a fresh named volume.
RUN mkdir -p /data && chown 1000:1000 /data

USER 1000:1000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
