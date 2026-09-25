import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AuthEmailDeliveryError,
  createDevelopmentAuthEmailMailbox,
  createLoginCodeEmailRenderer,
  createResendAuthEmailSender,
  renderLoginCodeEmail,
} from "../src/index.js";

void describe("Resend authentication email", () => {
  void it("renders escaped English and Spanish login-code messages", () => {
    const english = renderLoginCodeEmail({ appName: "Example <Admin>", email: " OWNER@EXAMPLE.COM ", otp: "123456" });
    assert.equal(english.to, "owner@example.com");
    assert.match(english.html, /Example &lt;Admin&gt;/u);
    assert.doesNotMatch(english.html, /Example <Admin>/u);

    const spanish = renderLoginCodeEmail({
      appName: "Observatory",
      email: "owner@example.com",
      locale: "es",
      otp: "654321",
    });
    assert.match(spanish.text, /Vence en 10 minutos/u);
  });

  void it("sends only the expected Resend fields", async () => {
    const requests: Request[] = [];
    const sender = createResendAuthEmailSender({
      apiKey: "secret-api-key",
      fetch: (input, init) => {
        requests.push(new Request(input, init));
        return Promise.resolve(
          Response.json({ id: "email_123" }, { headers: { "x-request-id": "request_123" }, status: 202 }),
        );
      },
      from: "Example <login@example.com>",
    });
    const receipt = await sender({ appName: "Example", email: "owner@example.com", otp: "123456" });
    assert.deepEqual(receipt, {
      locale: "en",
      messageId: "email_123",
      provider: "resend",
      providerRequestId: "request_123",
      recipient: "owner@example.com",
    });
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.headers.get("Authorization"), "Bearer secret-api-key");
    const body: unknown = await request.json();
    assert.deepEqual(body, {
      from: "Example <login@example.com>",
      html: '<p>Your Example verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:.2em">123456</p><p>It expires in 10 minutes.</p>',
      subject: "123456 is your Example code",
      text: "Your Example verification code is 123456. It expires in 10 minutes.",
      to: ["owner@example.com"],
    });
  });

  void it("returns a stable redacted provider error", async () => {
    const sender = createResendAuthEmailSender({
      apiKey: "secret-api-key",
      fetch: () =>
        Promise.resolve(
          new Response("provider internals", { headers: { "x-request-id": "request_failure" }, status: 429 }),
        ),
      from: "login@example.com",
    });
    await assert.rejects(
      sender({ appName: "Example", email: "owner@example.com", otp: "123456" }),
      (error: unknown) =>
        error instanceof AuthEmailDeliveryError &&
        error.message === "auth_email_delivery_failed" &&
        error.status === 429 &&
        error.providerRequestId === "request_failure",
    );
  });

  void it("rejects malformed addresses and codes before delivery", () => {
    assert.throws(
      () => renderLoginCodeEmail({ appName: "Example", email: "invalid", otp: "123456" }),
      /auth_email_recipient_invalid/u,
    );
    assert.throws(
      () => renderLoginCodeEmail({ appName: "Example", email: "owner@example.com", otp: "code" }),
      /auth_email_code_invalid/u,
    );
  });

  void it("supports custom localized templates and expiry", () => {
    const renderer = createLoginCodeEmailRenderer({
      en: {
        html: ({ appName, expiresInMinutes, otp }) => `<strong>${appName}:${otp}:${expiresInMinutes}</strong>`,
        subject: ({ appName }) => `Sign in to ${appName}`,
        text: ({ expiresInMinutes, otp }) => `${otp} expires in ${expiresInMinutes}`,
      },
    });
    assert.deepEqual(renderer({ appName: "Portal", email: "owner@example.com", expiresInMinutes: 5, otp: "123456" }), {
      html: "<strong>Portal:123456:5</strong>",
      subject: "Sign in to Portal",
      text: "123456 expires in 5",
      to: "owner@example.com",
    });
    assert.throws(
      () => renderLoginCodeEmail({ appName: "Portal", email: "owner@example.com", expiresInMinutes: 0, otp: "123456" }),
      /auth_email_expiry_invalid/u,
    );
  });

  void it("emits redacted delivery hooks without allowing hook errors to block delivery", async () => {
    const events: string[] = [];
    const sender = createResendAuthEmailSender({
      apiKey: "secret-api-key",
      fetch: () => Promise.resolve(Response.json({ id: "email_123" }, { status: 202 })),
      from: "login@example.com",
      hooks: {
        onAttempt: (metadata) => {
          assert.equal("otp" in metadata, false);
          events.push(`attempt:${metadata.recipient}`);
          throw new Error("observability unavailable");
        },
        onDelivered: (receipt) => {
          events.push(`delivered:${receipt.messageId ?? "unknown"}`);
        },
      },
    });
    await sender({ appName: "Example", email: "owner@example.com", otp: "123456" });
    assert.deepEqual(events, ["attempt:owner@example.com", "delivered:email_123"]);
  });

  void it("exposes codes only through an explicit localhost development mailbox", async () => {
    assert.throws(
      () => createDevelopmentAuthEmailMailbox({ enabled: false, origin: "http://localhost:4321" }),
      /auth_email_dev_mailbox_disabled/u,
    );
    for (const origin of ["https://example.com", "http://localhost:4321/path"]) {
      assert.throws(
        () => createDevelopmentAuthEmailMailbox({ enabled: true, origin }),
        /auth_email_dev_mailbox_origin_invalid/u,
      );
    }

    const mailbox = createDevelopmentAuthEmailMailbox({ enabled: true, origin: "http://127.0.0.1:4321" });
    await mailbox.send({ appName: "Example", email: "owner@example.com", otp: "123456" });
    assert.equal(mailbox.messages.length, 1);
    assert.match(mailbox.messages[0]?.text ?? "", /123456/u);
    const snapshot = mailbox.messages;
    mailbox.clear();
    assert.equal(mailbox.messages.length, 0);
    assert.equal(snapshot.length, 1);
  });
});
