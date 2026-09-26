# `@santi020k/auth-email-resend`

Resend delivery for authentication codes with English and Spanish templates. Provider failures expose only a stable error
code and HTTP status; response bodies, API keys, and authorization headers are never returned or logged.

```ts
const sendLoginCode = createResendAuthEmailSender({
  apiKey: env.RESEND_API_KEY,
  from: env.MAIL_FROM,
});

const receipt = await sendLoginCode({ appName: "Example", email, otp });
// receipt.messageId and receipt.providerRequestId are safe correlation identifiers.
```

Consumers still own secret injection, sender-domain configuration, and locale selection. `renderEmail` or
`createLoginCodeEmailRenderer()` can customize copy and markup. `onAttempt`, `onDelivered`, and `onFailed` hooks receive
redacted metadata (never the code or provider response body); hook failures do not change delivery behavior.

The Resend request aborts after `timeoutMs` (default 10000) instead of hanging on an unresponsive provider, surfacing
the same redacted `AuthEmailDeliveryError` an HTTP failure would so `onFailed` and consumer retry policy still run.

For local browser development only, an in-memory mailbox is available behind two gates: `enabled: true` and an exact
localhost/loopback origin. It throws for remote origins and when disabled, so it cannot become a production fallback:

```ts
const mailbox = createDevelopmentAuthEmailMailbox({
  enabled: env.EXPOSE_AUTH_CODES === "true",
  origin: "http://localhost:4321",
});
await mailbox.send({ appName: "Example", email, otp });
```
