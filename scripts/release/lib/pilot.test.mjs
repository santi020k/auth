import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bundledDependencyNames, checksumFile, createPilotManifest, pilotOutputArgument } from "./pilot.mjs";

const packages = [
  {
    filename: "santi020k-auth-migrations-0.4.0.tgz",
    integrity: "sha512-migrations",
    manifest: { name: "@santi020k/auth-migrations" },
    name: "@santi020k/auth-migrations",
    sha256: "aaa",
    version: "0.4.0",
  },
  {
    filename: "santi020k-auth-testing-0.4.0.tgz",
    integrity: "sha512-testing",
    manifest: {
      dependencies: { "@santi020k/auth-migrations": "0.4.0", miniflare: "5.0.0" },
      name: "@santi020k/auth-testing",
    },
    name: "@santi020k/auth-testing",
    sha256: "bbb",
    version: "0.4.0",
  },
];

void describe("pilot bundle metadata", () => {
  void it("accepts pnpm's optional argument separator", () => {
    assert.equal(pilotOutputArgument(["--", "dist/consumer"]), "dist/consumer");
    assert.equal(pilotOutputArgument(["dist/consumer"]), "dist/consumer");
    assert.equal(pilotOutputArgument([]), "dist/pilot-bundle");
    assert.equal(pilotOutputArgument(["--"]), "dist/pilot-bundle");
    assert.throws(() => pilotOutputArgument(["one", "two"]), /Usage:/u);
  });

  void it("records bundled runtime dependencies needed for offline installation", () => {
    assert.deepEqual(bundledDependencyNames(packages[1].manifest, new Set(packages.map((entry) => entry.name))), [
      "@santi020k/auth-migrations",
    ]);
  });

  void it("creates a deterministic provenance manifest", () => {
    assert.deepEqual(createPilotManifest({ packages, sourceCommit: "abc123", version: "0.4.0" }), {
      schemaVersion: 1,
      kind: "@santi020k/auth-pilot-bundle",
      version: "0.4.0",
      source: { commit: "abc123", repository: "https://github.com/santi020k/auth" },
      packages: [
        {
          name: "@santi020k/auth-migrations",
          version: "0.4.0",
          filename: "santi020k-auth-migrations-0.4.0.tgz",
          sha256: "aaa",
          integrity: "sha512-migrations",
          bundledDependencies: [],
        },
        {
          name: "@santi020k/auth-testing",
          version: "0.4.0",
          filename: "santi020k-auth-testing-0.4.0.tgz",
          sha256: "bbb",
          integrity: "sha512-testing",
          bundledDependencies: ["@santi020k/auth-migrations"],
        },
      ],
      pnpmOverrideTargets: [
        {
          selector: "@santi020k/auth-migrations@0.4.0",
          filename: "santi020k-auth-migrations-0.4.0.tgz",
        },
      ],
    });
  });

  void it("writes checksums in manifest order", () => {
    assert.equal(
      checksumFile(packages),
      "aaa  santi020k-auth-migrations-0.4.0.tgz\nbbb  santi020k-auth-testing-0.4.0.tgz\n",
    );
  });
});
