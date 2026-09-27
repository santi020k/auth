import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLocalMachineCredentialProvider } from "../src/machine.js";

void describe("local machine credential provider", () => {
  void it("reuses an active credential and refreshes it at expiry", async () => {
    let now = Date.parse("2026-09-25T00:00:00.000Z");
    const getCredential = createLocalMachineCredentialProvider(() => now);
    const initial = await getCredential();
    now += 60 * 60 * 1000 - 1;
    assert.equal(await getCredential(), initial);

    now += 1;
    const refreshed = await getCredential();
    assert.notEqual(refreshed.token, initial.token);
    assert.equal(refreshed.record.createdAt, "2026-09-25T01:00:00.000Z");
    assert.equal(refreshed.record.expiresAt, "2026-09-25T02:00:00.000Z");
  });

  void it("shares one refresh across concurrent callers", async () => {
    const now = Date.parse("2026-09-25T00:00:00.000Z");
    const getCredential = createLocalMachineCredentialProvider(() => now);
    const [first, second] = await Promise.all([getCredential(), getCredential()]);
    assert.equal(first, second);
  });
});
