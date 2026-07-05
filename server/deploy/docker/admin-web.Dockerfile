FROM oven/bun:1.3.5 AS build

WORKDIR /app

COPY admin-web/package.json admin-web/bun.lock admin-web/bunfig.toml ./
RUN bun install --frozen-lockfile

COPY admin-web/ ./
RUN bun run build

FROM nginx:1.27-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
