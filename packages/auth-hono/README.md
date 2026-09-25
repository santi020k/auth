# `@santi020k/auth-hono`

Small Hono adapters for mounting an auth handler, resolving a session, and protecting routes. The adapter does not choose
paths, redirects, authorization roles, or the consumer's context-variable shape.

Hono is a peer dependency (`>=4.12.30 <5`) so a consumer has one `Context` and `HonoRequest` type identity. Do not add a
second runtime Hono copy through this package.

```ts
app.all(
  "/api/auth/*",
  createHonoAuthHandler((context) => createAuth(context.env, context.req.raw)),
);

app.use(
  "/private/*",
  createRequireHonoAuth({
    createAuth: (context) => createAuth(context.env, context.req.raw),
  }),
);
```

Credentialed cross-origin consumers must opt into exact origins. Wildcards, patterns, insecure remote origins, and
origins containing paths are rejected during configuration:

```ts
app.use(
  "/api/auth/*",
  createHonoAuthCors({
    allowedOrigins: ["https://app.example.com"],
    allowHeaders: ["Content-Type", "X-CSRF-Token"],
    maxAgeSeconds: 600,
  }),
);
```

Requests with no `Origin` header continue normally for same-origin and server-to-server use. Requests carrying an
unlisted origin receive `403`; credentialed responses echo only the exact matched origin and include `Vary: Origin`.

Sensitive product routes can additionally require a recently created authentication session:

```ts
app.use(
  "/settings/security/*",
  createRequireRecentHonoAuth({
    createAuth: (context) => createAuth(context.env, context.req.raw),
    maxAgeSeconds: 15 * 60,
  }),
);
```

An absent session receives `401`; an old or malformed `authenticatedAt` receives `403` with
`recent_authentication_required`. The consumer chooses the step-up method and continues to own authorization and
recovery policy.
