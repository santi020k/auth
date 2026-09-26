import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consumeRecoveryCode,
  type ConsumeRecoveryCodeInput,
  digestRecoveryCode,
  generateRecoveryCode,
  issueRecoveryCodes,
  normalizeRecoveryCode,
  type RecoveryCodeStore,
  type ReplaceRecoveryCodesInput,
} from "../src/index.js";

const pepperA = "a".repeat(32);
const pepperB = "b".repeat(32);

class AtomicMemoryStore implements RecoveryCodeStore {
  readonly consumedInputs: ConsumeRecoveryCodeInput[] = [];
  readonly replacements: ReplaceRecoveryCodesInput[] = [];
  readonly #digests = new Map<string, Set<string>>();

  consumeRecoveryCodeAtomically(input: ConsumeRecoveryCodeInput): Promise<boolean> {
    this.consumedInputs.push(input);
    const digests = this.#digests.get(input.subject);
    const consumed = digests?.delete(input.digest) ?? false;
    return Promise.resolve(consumed);
  }

  replaceRecoveryCodes(input: ReplaceRecoveryCodesInput): Promise<void> {
    this.replacements.push(input);
    this.#digests.set(input.subject, new Set(input.records.map((record) => record.digest)));
    return Promise.resolve();
  }
}

void describe("recovery-code primitives", () => {
  void it("normalizes ASCII case and separators without accepting ambiguous lookalikes", () => {
    const generated = "BRAVE-CRASH-SPEED-TRACK";
    assert.equal(normalizeRecoveryCode(" brave crash-speed-track\n"), generated.replaceAll("-", ""));
    for (const invalid of [
      "BRAVE-CRASH-SPEED-00000",
      "BRAVE-CRASH-SPEED-LIGHT",
      "BRAVE‑CRASH-SPEED-TRACK",
      "BRAVE-CRASH-SPEED-CATß",
      "BRAVE-CRASH-SPEED",
      "BRAVE-CRASH-SPEED-TRACK-BRAVE",
    ]) {
      assert.throws(() => normalizeRecoveryCode(invalid), /auth_recovery_code_invalid/u);
    }
  });

  void it("generates high-entropy-shaped, human-enterable, unique codes", () => {
    const codes = Array.from({ length: 256 }, () => generateRecoveryCode());
    assert.equal(new Set(codes).size, codes.length);
    for (const code of codes) {
      assert.match(code, /^(?:[A-Z2-9]{5}-){3}[A-Z2-9]{5}$/u);
      assert.doesNotMatch(code, /[01ILO]/u);
    }
  });

  void it("creates deterministic digests isolated by subject and pepper", async () => {
    const code = "BRAVE-CRASH-SPEED-TRACK";
    const original = await digestRecoveryCode({ code, pepper: pepperA, subject: "user-a" });
    assert.equal(await digestRecoveryCode({ code: code.toLowerCase(), pepper: pepperA, subject: "user-a" }), original);
    assert.notEqual(await digestRecoveryCode({ code, pepper: pepperA, subject: "user-b" }), original);
    assert.notEqual(await digestRecoveryCode({ code, pepper: pepperB, subject: "user-a" }), original);
    assert.match(original, /^v1\.[A-Za-z0-9_-]{43}$/u);
  });

  void it("rejects invalid configuration before persistence", async () => {
    const store = new AtomicMemoryStore();
    await assert.rejects(
      issueRecoveryCodes({ count: 0, pepper: pepperA, store, subject: "user-a" }),
      /auth_recovery_code_count_invalid/u,
    );
    await assert.rejects(
      issueRecoveryCodes({ pepper: "short", store, subject: "user-a" }),
      /auth_recovery_pepper_too_short/u,
    );
    await assert.rejects(
      issueRecoveryCodes({ pepper: pepperA, store, subject: " user-a" }),
      /auth_recovery_subject_invalid/u,
    );
    assert.equal(store.replacements.length, 0);
  });

  void it("persists only digests and returns plaintext only from issuance", async () => {
    const store = new AtomicMemoryStore();
    const codes = await issueRecoveryCodes({ count: 4, pepper: pepperA, store, subject: "user-a" });
    assert.equal(codes.length, 4);
    assert.equal(store.replacements.length, 1);
    const replacement = store.replacements[0];
    assert.ok(replacement);
    assert.equal(replacement.subject, "user-a");
    assert.equal(replacement.records.length, 4);
    const persisted = JSON.stringify(replacement);
    for (const code of codes) assert.equal(persisted.includes(code), false);
    for (const record of replacement.records) assert.match(record.digest, /^v1\./u);
  });

  void it("delegates an atomic single-use decision and rejects reuse", async () => {
    const store = new AtomicMemoryStore();
    const [code] = await issueRecoveryCodes({ count: 1, pepper: pepperA, store, subject: "user-a" });
    assert.ok(code);
    const attempts = await Promise.all([
      consumeRecoveryCode({ code, pepper: pepperA, store, subject: "user-a" }),
      consumeRecoveryCode({ code, pepper: pepperA, store, subject: "user-a" }),
    ]);
    assert.deepEqual(attempts.sort(), [false, true]);
    assert.equal(store.consumedInputs.length, 2);
    assert.equal(await consumeRecoveryCode({ code, pepper: pepperA, store, subject: "user-b" }), false);
    assert.equal(await consumeRecoveryCode({ code: "invalid", pepper: pepperA, store, subject: "user-a" }), false);
    assert.equal(store.consumedInputs.length, 3);
  });

  void it("requires stores to replace the complete app-owned digest set", async () => {
    const store = new AtomicMemoryStore();
    const first = await issueRecoveryCodes({ count: 2, pepper: pepperA, store, subject: "user-a" });
    const second = await issueRecoveryCodes({ count: 2, pepper: pepperA, store, subject: "user-a" });
    assert.equal(store.replacements.length, 2);
    for (const code of first) {
      assert.equal(await consumeRecoveryCode({ code, pepper: pepperA, store, subject: "user-a" }), false);
    }
    assert.equal(await consumeRecoveryCode({ code: second[0] ?? "", pepper: pepperA, store, subject: "user-a" }), true);
  });
});
