# syntax=docker/dockerfile:1.7
#
# Build context is the REPO ROOT (see docker-compose.yml), not this directory,
# because `@shared/*` resolves to ../shared (next.config.mjs / tsconfig.json) and
# that code must sit next to this package inside the image.

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app/frontend
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/frontend/node_modules ./node_modules
# Shared core as a sibling of the package so ../shared resolves.
COPY shared /app/shared
COPY frontend ./

# Browser-facing URLs are baked in at build time (NEXT_PUBLIC_* are inlined into
# the client bundle). They must point to where the *browser* — not the container
# — reaches the API. Override at build time with --build-arg if needed.
ARG NEXT_PUBLIC_API_BASE=http://localhost:8080
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S app && adduser -S app -G app
USER app

# `output: standalone` produces these three trees. Together they form the entire
# runtime — no node_modules copy needed.
COPY --from=build --chown=app:app /app/frontend/.next/standalone ./
COPY --from=build --chown=app:app /app/frontend/.next/static ./.next/static
COPY --from=build --chown=app:app /app/frontend/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
