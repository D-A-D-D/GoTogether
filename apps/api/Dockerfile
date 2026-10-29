# The GoTogether API as a container image. Build from the repository root:
#
#   docker build -f apps/api/Dockerfile -t gotogether-api .
#
# Two stages: one with the full toolchain to compile, and a small runtime image
# with only production dependencies. Both use the same base, because Prisma's
# query engine is a native binary generated for the system it is built on.
#
# Configuration is entirely environment variables (docs/DEPLOYMENT.md); nothing
# secret is baked in, and the API refuses to start in production if it is wrong.

# ---- build ------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Prisma's engine needs OpenSSL.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, so this layer is reused until a package.json or the lockfile changes.
# apps/web/package.json is needed only so npm can read the whole workspace; its dependencies are not installed.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api

COPY apps/api apps/api
# Generates the Prisma client (and the engine for *this* system) into src/generated, then compiles into dist.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
    && npm run build --workspace apps/api

# ---- runtime ----------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# `prisma` is a runtime dependency on purpose: a release runs `npx prisma migrate deploy` from this same image.
RUN npm ci --omit=dev --workspace apps/api && npm cache clean --force

# The compiled app, with the generated client and its engine (copied as assets by `nest build`),
# and the migrations.
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma

WORKDIR /app/apps/api
# Never run as root.
USER node
EXPOSE 3001

# Liveness only (it does not touch the database): the process is up. Platforms that
# understand readiness should use /health/ready instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
