# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS bun
FROM node:22.23.4-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV VP_GIT_HOOKS=0
ENV PATH="/app/node_modules/.bin:${PATH}"
COPY package.json bun.lock .node-version tsconfig.json vite.config.ts ./
COPY packages/core/package.json ./packages/core/
COPY packages/tsed/package.json ./packages/tsed/
COPY packages/management/package.json ./packages/management/
COPY packages/management-express/package.json ./packages/management-express/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/dashboard-express/package.json ./packages/dashboard-express/
COPY apps/docs/package.json ./apps/docs/
COPY apps/dashboard-dev/package.json ./apps/dashboard-dev/
RUN bun install --frozen-lockfile
COPY . .
RUN vp run @monque/dashboard#build

FROM nginx:1.30.6-alpine AS runtime
RUN apk add --no-cache jq
COPY --from=build /app/packages/dashboard/dist/client /usr/share/nginx/html
COPY packages/dashboard/docker/nginx.conf.template /opt/dashboard/nginx.conf.template
COPY --chmod=755 packages/dashboard/docker/entrypoint.sh /usr/local/bin/dashboard-entrypoint
ENV PORT=3000
USER nginx
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -T 2 -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
ENTRYPOINT ["/usr/local/bin/dashboard-entrypoint"]
