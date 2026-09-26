import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRemoteTagOutput, planPublish, planTag, waitForNpmVersion } from "./registry.mjs";

void describe("planPublish", () => {
  void it("publishes a version that does not exist on the registry yet", () => {
    assert.equal(planPublish({ localIntegrity: "sha512-a", registryVersionExists: false }), "publish");
  });

  void it("skips a version whose published integrity matches the local build", () => {
    assert.equal(
      planPublish({ localIntegrity: "sha512-a", registryIntegrity: "sha512-a", registryVersionExists: true }),
      "skip-matches",
    );
  });

  void it("refuses to proceed when published integrity does not match the local build", () => {
    assert.equal(
      planPublish({ localIntegrity: "sha512-a", registryIntegrity: "sha512-b", registryVersionExists: true }),
      "error-mismatch",
    );
  });
});

void describe("planTag", () => {
  void it("creates a tag that does not exist yet", () => {
    assert.equal(planTag({ releaseCommit: "abc", remoteCommit: null, tagExists: false }), "create");
  });

  void it("accepts an existing tag that already points at the release commit", () => {
    assert.equal(planTag({ releaseCommit: "abc", remoteCommit: "abc", tagExists: true }), "already-correct");
  });

  void it("refuses to move an existing tag to a different commit", () => {
    assert.equal(planTag({ releaseCommit: "abc", remoteCommit: "def", tagExists: true }), "conflict");
  });
});

void describe("waitForNpmVersion", () => {
  void it("retries bounded registry propagation until the expected version is visible", () => {
    const responses = [null, null, "0.4.0"];
    const delays = [];

    const verified = waitForNpmVersion("@santi020k/auth-example@0.4.0", "0.4.0", {
      attempts: 3,
      delayMs: 25,
      readVersion: () => responses.shift() ?? null,
      sleep: (delayMs) => delays.push(delayMs),
    });

    assert.equal(verified, true);
    assert.deepEqual(delays, [25, 25]);
  });

  void it("returns false after exhausting the bounded visibility window", () => {
    let reads = 0;
    const verified = waitForNpmVersion("@santi020k/auth-example@0.4.0", "0.4.0", {
      attempts: 2,
      delayMs: 0,
      readVersion: () => {
        reads += 1;
        return null;
      },
      sleep: () => undefined,
    });

    assert.equal(verified, false);
    assert.equal(reads, 2);
  });
});

void describe("parseRemoteTagOutput", () => {
  void it("uses the peeled commit for an annotated tag", () => {
    const output = ["tag-object\trefs/tags/v1.0.0", "release-commit\trefs/tags/v1.0.0^{}"].join("\n");
    assert.equal(parseRemoteTagOutput(output), "release-commit");
  });

  void it("uses the direct commit for a lightweight tag", () => {
    assert.equal(parseRemoteTagOutput("release-commit\trefs/tags/v1.0.0\n"), "release-commit");
  });

  void it("returns null for empty output", () => {
    assert.equal(parseRemoteTagOutput(""), null);
  });
});
