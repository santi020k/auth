import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertMachineScopes,
  createMachineCredential,
  hashMachineToken,
  machineHasScopes,
  parseMachineCredentials,
  resolveMachineBearer,
} from "../src/index.js";

void describe("machine authentication", () => {
  void it("creates a high-entropy token while keeping only its digest in server metadata", async () => {
    const created = await createMachineCredential({
      credentialId: "codex-marketing",
      expiresAt: "2027-01-01T00:00:00Z",
      name: "Codex Marketing",
      scopes: ["planner:read", "planner:drafts:write"],
      subject: "machine:codex-marketing",
    });
    assert.match(created.token, /^sma_codex-marketing_[A-Za-z0-9_-]{43}$/u);
    assert.equal(created.record.tokenHash, await hashMachineToken(created.token));
    assert.equal(JSON.stringify(created.record).includes(created.token), false);
  });

  void it("resolves only an unexpired credential with the matching token", async () => {
    const created = await createMachineCredential({
      credentialId: "codex-marketing",
      expiresAt: "2027-01-01T00:00:00Z",
      name: "Codex Marketing",
      scopes: ["planner:read"],
      subject: "machine:codex-marketing",
    });
    const request = new Request("https://planner.example.com/mcp", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert.deepEqual(await resolveMachineBearer(request, [created.record], Date.parse("2026-09-25T00:00:00Z")), {
      credentialId: "codex-marketing",
      name: "Codex Marketing",
      scopes: ["planner:read"],
      subject: "machine:codex-marketing",
    });
    assert.equal(await resolveMachineBearer(request, [created.record], Date.parse("2027-01-01T00:00:00Z")), null);
    assert.equal(
      await resolveMachineBearer(
        new Request("https://planner.example.com/mcp", { headers: { Authorization: "Bearer invalid" } }),
        [created.record],
      ),
      null,
    );
  });

  void it("enforces explicit scopes", () => {
    const principal = {
      credentialId: "codex-marketing",
      name: "Codex Marketing",
      scopes: ["planner:read"],
      subject: "machine:codex-marketing",
    };
    assert.equal(machineHasScopes(principal, ["planner:read"]), true);
    assert.equal(machineHasScopes(principal, ["planner:drafts:write"]), false);
    assert.throws(() => {
      assertMachineScopes(principal, ["planner:drafts:write"]);
    }, /machine_auth_scope_required/u);
  });

  void it("rejects malformed, duplicate, or raw-token credential configuration", () => {
    assert.deepEqual(parseMachineCredentials(undefined), []);
    for (const value of [
      "not-json",
      "[]",
      JSON.stringify([
        {
          credentialId: "Codex",
          name: "Codex",
          scopes: ["planner:read"],
          subject: "machine:codex",
          tokenHash: "secret",
        },
      ]),
      JSON.stringify([
        {
          credentialId: "codex",
          name: "Codex",
          scopes: ["planner:read"],
          subject: "machine:codex",
          tokenHash: `sha256:${"a".repeat(64)}`,
        },
        {
          credentialId: "codex",
          name: "Other",
          scopes: ["planner:read"],
          subject: "machine:other",
          tokenHash: `sha256:${"b".repeat(64)}`,
        },
      ]),
    ]) {
      assert.throws(() => parseMachineCredentials(value), /machine_auth_credentials_invalid/u);
    }
  });
});
