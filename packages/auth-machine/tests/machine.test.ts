import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertMachineScopes,
  createMachineCredential,
  hashMachineToken,
  type MachineAuthEvent,
  machineHasScopes,
  parseMachineCredentials,
  resolveMachineBearer,
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
      [{ ...created.record, revokedAt: "2026-09-26T00:00:00Z" }, createdAt, "credential_revoked"],
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
});
