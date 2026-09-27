import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertMachineScopes,
  createMachineCredential,
  hashMachineToken,
  listMachineCredentialInventory,
  type MachineAuthEvent,
  machineHasScopes,
  parseMachineCredentials,
  resolveMachineBearer,
  revokeMachineCredential,
  rotateMachineCredential,
} from "../src/index.js";

const createdAt = Date.parse("2026-09-25T00:00:00Z");
const expiresAt = "2027-01-01T00:00:00Z";

function options() {
  return {
    credentialId: "codex-marketing",
    expiresAt,
    name: "Codex Marketing",
    now: createdAt,
    scopes: ["planner:read", "planner:drafts:write"],
    subject: "machine:codex-marketing",
  } as const;
}

void describe("machine authentication", () => {
  void it("creates an expiring high-entropy token while keeping only its digest in server metadata", async () => {
    const created = await createMachineCredential(options());
    assert.match(created.token, /^sma_codex-marketing_[A-Za-z0-9_-]{43}$/u);
    assert.equal(created.record.tokenHash, await hashMachineToken(created.token));
    assert.equal(created.record.createdAt, "2026-09-25T00:00:00.000Z");
    assert.equal(created.record.expiresAt, expiresAt);
    assert.equal(JSON.stringify(created.record).includes(created.token), false);
  });

  void it("resolves only active, unexpired, non-revoked credentials and emits redacted events", async () => {
    const created = await createMachineCredential(options());
    const request = new Request("https://planner.example.com/mcp", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    const events: MachineAuthEvent[] = [];
    assert.deepEqual(
      await resolveMachineBearer(request, [created.record], {
        now: createdAt,
        onSecurityEvent: (event) => {
          events.push(event);
        },
      }),
      {
        credentialId: "codex-marketing",
        name: "Codex Marketing",
        scopes: ["planner:read", "planner:drafts:write"],
        subject: "machine:codex-marketing",
      },
    );
    assert.deepEqual(events, [
      { credentialId: "codex-marketing", subject: "machine:codex-marketing", type: "machine_auth_succeeded" },
    ]);
    assert.equal(JSON.stringify(events).includes(created.token), false);

    for (const [record, now, reason] of [
      [created.record, Date.parse(expiresAt), "credential_expired"],
      [{ ...created.record, notBefore: "2026-10-01T00:00:00Z" }, createdAt, "credential_not_active"],
      [{ ...created.record, revokedAt: "2026-09-25T00:00:00Z" }, createdAt, "credential_revoked"],
    ] as const) {
      const rejected: MachineAuthEvent[] = [];
      assert.equal(
        await resolveMachineBearer(request, [record], {
          now,
          onSecurityEvent: (event) => {
            rejected.push(event);
          },
        }),
        null,
      );
      assert.deepEqual(rejected, [{ credentialId: "codex-marketing", reason, type: "machine_auth_rejected" }]);
    }
  });

  void it("rejects malformed and unknown tokens without leaking observability failures", async () => {
    const created = await createMachineCredential(options());
    const invalid = new Request("https://planner.example.com/mcp", {
      headers: { Authorization: "Bearer invalid" },
    });
    assert.equal(
      await resolveMachineBearer(invalid, [created.record], {
        onSecurityEvent: () => {
          throw new Error("audit unavailable");
        },
      }),
      null,
    );
  });

  void it("resolves one validated record asynchronously without exposing the token to the resolver", async () => {
    const created = await createMachineCredential(options());
    const request = new Request("https://planner.example.com/mcp", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    const identifiers: string[] = [];
    const principal = await resolveMachineBearer(request, (credentialId) => {
      identifiers.push(credentialId);
      return Promise.resolve(created.record);
    });
    assert.equal(principal?.credentialId, created.record.credentialId);
    assert.deepEqual(identifiers, [created.record.credentialId]);
    assert.equal(JSON.stringify(identifiers).includes(created.token), false);
  });

  void it("bounds attacker-controlled input before resolver lookup or event emission", async () => {
    const lookedUp: string[] = [];
    const events: MachineAuthEvent[] = [];
    for (const authorization of [
      `Bearer sma_${"a".repeat(81)}_${"A".repeat(43)}`,
      `Bearer ${"x".repeat(129)}`,
      `Bearer sma_valid_${"A".repeat(43)}${"padding".repeat(100)}`,
    ]) {
      assert.equal(
        await resolveMachineBearer(
          new Request("https://planner.example.com/mcp", { headers: { Authorization: authorization } }),
          (credentialId) => {
            lookedUp.push(credentialId);
            return null;
          },
          {
            onSecurityEvent: (event) => {
              events.push(event);
            },
          },
        ),
        null,
      );
    }
    assert.deepEqual(lookedUp, []);
    assert.equal(events.length, 3);
    assert.ok(events.every((event) => event.type === "machine_auth_rejected" && event.credentialId === "unknown"));
    assert.equal(JSON.stringify(events).includes("padding"), false);
  });

  void it("fails closed with a redacted event when credential lookup fails or returns invalid metadata", async () => {
    const created = await createMachineCredential(options());
    const request = new Request("https://planner.example.com/mcp", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    for (const resolver of [
      () => Promise.reject(new Error(`database unavailable for ${created.token}`)),
      () => Promise.resolve({ ...created.record, tokenHash: created.token }),
      () => Promise.resolve({ ...created.record, credentialId: "different-credential" }),
    ]) {
      const events: MachineAuthEvent[] = [];
      assert.equal(
        await resolveMachineBearer(request, resolver, {
          onSecurityEvent: (event) => {
            events.push(event);
          },
        }),
        null,
      );
      assert.deepEqual(events, [
        {
          credentialId: created.record.credentialId,
          reason: "credential_resolution_failed",
          type: "machine_auth_rejected",
        },
      ]);
      assert.equal(JSON.stringify(events).includes(created.token), false);
    }
  });

  void it("requires at least one explicit scope", () => {
    const principal = {
      credentialId: "codex-marketing",
      name: "Codex Marketing",
      scopes: ["planner:read"],
      subject: "machine:codex-marketing",
    };
    assert.equal(machineHasScopes(principal, ["planner:read"]), true);
    assert.equal(machineHasScopes(principal, ["planner:drafts:write"]), false);
    assert.equal(machineHasScopes(principal, []), false);
    assert.throws(() => {
      assertMachineScopes(principal, []);
    }, /machine_auth_scope_required/u);
  });

  void it("rejects missing lifecycle fields, malformed records, duplicates, and raw tokens", async () => {
    const created = await createMachineCredential(options());
    assert.deepEqual(parseMachineCredentials(undefined), []);
    assert.deepEqual(parseMachineCredentials(JSON.stringify([created.record])), [created.record]);
    for (const value of [
      "not-json",
      "[]",
      JSON.stringify([{ ...created.record, createdAt: undefined }]),
      JSON.stringify([{ ...created.record, expiresAt: "2026-01-01T00:00:00Z" }]),
      JSON.stringify([{ ...created.record, tokenHash: created.token }]),
      JSON.stringify([{ ...created.record, scopes: [`reports:${"a".repeat(120)}`] }]),
      JSON.stringify([created.record, { ...created.record, subject: "machine:other" }]),
    ]) {
      assert.throws(() => parseMachineCredentials(value), /machine_auth_credentials_invalid/u);
    }
  });

  void it("rejects credentials that are already expired when created", async () => {
    await assert.rejects(
      createMachineCredential({ ...options(), expiresAt: "2026-09-24T00:00:00Z" }),
      /machine_auth_credentials_invalid/u,
    );
  });

  void it("revokes idempotently and lists only safe credential metadata", async () => {
    const created = await createMachineCredential(options());
    const revoked = revokeMachineCredential(created.record, { now: createdAt + 1_000 });
    assert.equal(revoked.revokedAt, "2026-09-25T00:00:01.000Z");
    assert.deepEqual(revokeMachineCredential(revoked, { now: createdAt + 2_000 }), revoked);
    const inventory = listMachineCredentialInventory([revoked]);
    assert.deepEqual(inventory, [
      {
        createdAt: revoked.createdAt,
        credentialId: revoked.credentialId,
        expiresAt: revoked.expiresAt,
        name: revoked.name,
        revokedAt: revoked.revokedAt,
        scopes: revoked.scopes,
        subject: revoked.subject,
      },
    ]);
    assert.equal(JSON.stringify(inventory).includes("tokenHash"), false);
  });

  void it("lets incident response override a scheduled future retirement", async () => {
    const created = await createMachineCredential(options());
    const scheduled = { ...created.record, revokedAt: "2026-09-25T01:00:00.000Z" };
    const revoked = revokeMachineCredential(scheduled, { now: createdAt });
    assert.equal(revoked.revokedAt, "2026-09-25T00:00:00.000Z");
    const request = new Request("https://planner.example.com/mcp", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert.equal(await resolveMachineBearer(request, [revoked], { now: createdAt }), null);
  });

  void it("rotates with explicit overlap and test-only injected entropy", async () => {
    const original = await createMachineCredential(options());
    const retirePreviousAt = "2026-09-25T00:05:00.000Z";
    const rotated = await rotateMachineCredential(original.record, {
      entropySource: (length) => new Uint8Array(length).fill(7),
      expiresAt: "2027-06-01T00:00:00Z",
      newCredentialId: "codex-marketing-2",
      now: createdAt,
      retirePreviousAt,
    });
    assert.equal(rotated.previousRecord.revokedAt, retirePreviousAt);
    assert.equal(rotated.replacement.record.credentialId, "codex-marketing-2");
    assert.equal(rotated.replacement.record.subject, original.record.subject);
    assert.equal(rotated.replacement.record.tokenHash, await hashMachineToken(rotated.replacement.token));

    const originalRequest = new Request("https://planner.example.com/mcp", {
      headers: { Authorization: `Bearer ${original.token}` },
    });
    assert.notEqual(
      await resolveMachineBearer(originalRequest, [rotated.previousRecord], { now: createdAt + 299_999 }),
      null,
    );
    assert.equal(
      await resolveMachineBearer(originalRequest, [rotated.previousRecord], { now: createdAt + 300_000 }),
      null,
    );
  });

  void it("rejects invalid entropy and implicit rotation retirement", async () => {
    await assert.rejects(
      createMachineCredential({ ...options(), entropySource: () => new Uint8Array(31) }),
      /machine_auth_entropy_invalid/u,
    );
    const original = await createMachineCredential(options());
    await assert.rejects(
      rotateMachineCredential(original.record, {
        expiresAt: "2027-06-01T00:00:00Z",
        newCredentialId: "codex-marketing-2",
        now: createdAt,
        retirePreviousAt: "2026-09-24T23:59:59.000Z",
      }),
      /machine_auth_credentials_invalid/u,
    );
    await assert.rejects(
      rotateMachineCredential(original.record, {
        expiresAt: "2027-06-01T00:00:00Z",
        newCredentialId: original.record.credentialId,
        now: createdAt,
        retirePreviousAt: "2026-09-25T00:05:00.000Z",
      }),
      /machine_auth_credentials_invalid/u,
    );
  });
});
