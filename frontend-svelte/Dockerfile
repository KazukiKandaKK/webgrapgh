# syntax=docker/dockerfile:1.7

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY . .

# Browser-facing URLs are baked into the bundle at build time. Override with
# --build-arg when targeting non-default hosts.
ARG VITE_API_BASE=http://localhost:8080
ARG VITE_WS_URL=ws://localhost:8080/ws
ARG VITE_WS_LOGS_URL=ws://localhost:8080/ws/logs
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_WS_LOGS_URL=$VITE_WS_LOGS_URL

RUN npm run build

# ---------- runtime: vite preview ----------
# `vite preview` re-emits the same COOP/COEP headers `vite.config.ts` sets
# for `server:` — without those the worker can't construct SharedArrayBuffer
# on the client, so we use preview instead of a generic static server.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Vite preview re-parses vite.config.ts and writes a timestamp shim alongside
# it. /app must be writable by the runtime user — chown the workdir BEFORE
# switching users.
RUN addgroup -S app && adduser -S app -G app && chown app:app /app
USER app

COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/vite.config.ts ./vite.config.ts
COPY --from=build --chown=app:app /app/index.html ./index.html

EXPOSE 3000
CMD ["npm", "run", "preview"]
