---
name: hono-best-practices
description: Build production-ready Hono applications with best practices for routing, type safety, validation, middleware, and error handling. Use when creating Hono APIs, web servers, or when the user asks about Hono patterns, validation, or deployment.
---

# Hono Best Practices

## Route Handlers

Write handlers inline with route definitions for proper type inference:

```typescript
// Good - type inference works
app.get("/books/:id", (c) => {
  const id = c.req.param("id"); // Inferred
  return c.json({ id });
});

// Bad - loses type inference
const handler = (c: Context) => c.req.param("id"); // Can't infer
app.get("/books/:id", handler);
```

For controller-like patterns, use `createFactory`:

```typescript
import { createFactory } from "hono/factory";

const factory = createFactory();
const handlers = factory.createHandlers(logger(), (c) => c.json(c.var.foo));
app.get("/api", ...handlers);
```

## Project Structure

```
src/
├── index.ts          # Entry point
├── routes/           # Modular routers
├── services/         # Business logic
├── schemas/          # Zod validation schemas
└── middleware/       # Custom middleware
```

Use `app.route()` for modular organization:

```typescript
// routes/books.ts
const books = new Hono();
books.get("/", (c) => c.json("list"));
books.get("/:id", (c) => c.json(c.req.param("id")));
export default books;

// index.ts
app.route("/books", books);
```

## Type Safety

Define typed context variables:

```typescript
type AppVariables = {
  user: { id: string; email: string };
};

const app = new Hono<{ Variables: AppVariables }>();

app.get("/profile", (c) => {
  const user = c.get("user"); // Properly typed
  return c.json({ user });
});
```

Export app type for RPC client:

```typescript
// server.ts
const app = new Hono()
  .get("/posts", (c) => c.json([{ id: 1 }]))
  .post("/posts", (c) => c.json({ success: true }));
export type AppType = typeof app;

// client.ts
import { hc } from "hono/client";
const client = hc<AppType>("http://localhost:3000");
const posts = await client.posts.$get(); // Type-safe
```

## Validation with Zod

```typescript
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const createPostSchema = z.object({
  title: z.string().min(3).max(100),
  content: z.string().min(10),
  tags: z.array(z.string()).optional(),
});

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

app.post("/posts", zValidator("json", createPostSchema), (c) => {
  const data = c.req.valid("json"); // Fully typed
  return c.json({ success: true, data });
});

app.get("/posts", zValidator("query", querySchema), (c) => {
  const { page, limit } = c.req.valid("query");
  return c.json({ page, limit });
});
```

## Error Handling

```typescript
import { HTTPException } from "hono/http-exception";

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.notFound((c) => c.json({ error: "Not Found" }, 404));

// Throw HTTPException for custom errors
app.get("/posts/:id", async (c) => {
  const post = await db.findPost(c.req.param("id"));
  if (!post) {
    throw new HTTPException(404, { message: "Post not found" });
  }
  return c.json(post);
});
```

## Middleware

```typescript
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";
import { jwt } from "hono/jwt";
import { createMiddleware } from "hono/factory";

// Built-in middleware
app.use(logger());
app.use(secureHeaders());
app.use(cors());

// JWT for protected routes
app.use("/api/*", jwt({ secret: process.env.JWT_SECRET }));

// Custom middleware
const requestLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} - ${Date.now() - start}ms`);
});
```

## Routing Patterns

```typescript
// Regex constraints
app.get("/users/:id{[0-9]+}", (c) => c.json({ id: c.req.param("id") }));

// Optional parameters
app.get("/api/posts/:format?", (c) => {
  const format = c.req.param("format") || "json";
  return c.json({ format });
});

// Wildcard routes
app.get("/files/*", (c) => c.json({ path: c.req.path }));

// Base path
const api = new Hono().basePath("/api/v1");
api.get("/users", (c) => c.json([])); // /api/v1/users
```

## Performance

```typescript
// Minimal bundle (< 14kB)
import { Hono } from "hono/tiny";

// Fastest routing
import { Hono } from "hono/quick";

// Streaming
import { stream } from "hono/streaming";
app.get("/stream", (c) => {
  return stream(c, async (stream) => {
    for (let i = 0; i < 10; i++) {
      await stream.write(`data: ${i}\n\n`);
      await stream.sleep(100);
    }
  });
});
```

## Deployment

```typescript
// Node.js
import { serve } from "@hono/node-server";
serve({ fetch: app.fetch, port: 3000 });

// Cloudflare Workers
export default app;

// Bun
export default { port: 3000, fetch: app.fetch };

// Deno
Deno.serve(app.fetch);

// AWS Lambda
import { handle } from "hono/aws-lambda";
export const handler = handle(app);
```

## Quick Reference

1. Write handlers inline for type inference
2. Use `app.route()` for modular code
3. Validate with Zod + `@hono/zod-validator`
4. Handle errors with `app.onError()` and `HTTPException`
5. Use built-in middleware for security and logging
6. Export `AppType` for type-safe RPC clients
