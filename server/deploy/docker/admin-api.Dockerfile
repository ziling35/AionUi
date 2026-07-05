FROM oven/bun:1.3.5

WORKDIR /app

COPY admin-api/package.json admin-api/bun.lock admin-api/bunfig.toml ./
RUN bun install --frozen-lockfile

COPY admin-api/ ./
RUN bunx prisma generate --schema prisma/schema.prisma

EXPOSE 3000

CMD ["sh", "-c", "mkdir -p /data && bunx prisma migrate deploy --schema prisma/schema.prisma && bun run index.ts"]
