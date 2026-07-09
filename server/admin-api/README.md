# admin-api

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Production deployments must set `LINGCODEX_TOKEN_SECRET` to a high-entropy
secret of at least 32 characters; LingCodex token exchange is rejected without
it.

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
