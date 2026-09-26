import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateFixedGroupCoherence, validatePackageMetadata } from "./validate.mjs";

function manifest(overrides = {}) {
  return {
    files: ["dist"],
    license: "MIT",
    main: "./dist/index.js",
    name: "@santi020k/auth-example",
    publishConfig: { access: "public", provenance: false },
    repository: { directory: "packages/auth-example" },
    types: "./dist/index.d.ts",
    version: "0.1.0",
    ...overrides,
  };
}

void describe("validatePackageMetadata", () => {
  void it("accepts a well-formed publishable manifest", () => {
    const issues = validatePackageMetadata({ dir: "auth-example", manifest: manifest() });
    assert.deepEqual(issues, []);
  });

  void it("flags a private package only when publication is required", () => {
    const pkg = { dir: "auth-example", manifest: manifest({ private: true }) };
    assert.deepEqual(validatePackageMetadata(pkg, { requirePublishable: false }), []);
    assert.deepEqual(validatePackageMetadata(pkg, { requirePublishable: true }), [
      "@santi020k/auth-example: private packages cannot be published by the release workflow",
    ]);
  });

  void it("flags an invalid version and a mismatched repository directory", () => {
    const issues = validatePackageMetadata({
      dir: "auth-example",
      manifest: manifest({ repository: { directory: "packages/wrong" }, version: "not-semver" }),
    });
    assert.ok(issues.some((issue) => issue.includes("not valid semver")));
    assert.ok(issues.some((issue) => issue.includes("repository.directory")));
  });

  void it("flags provenance turned on while the repository stays private", () => {
    const issues = validatePackageMetadata({
      dir: "auth-example",
      manifest: manifest({ publishConfig: { access: "public", provenance: true } }),
    });
    assert.ok(issues.some((issue) => issue.includes("provenance must stay false")));
  });
});

void describe("validateFixedGroupCoherence", () => {
  const packages = [
    {
      dir: "auth-cloudflare",
      manifest: manifest({
        dependencies: { "@santi020k/auth-migrations": "workspace:*" },
        name: "@santi020k/auth-cloudflare",
      }),
    },
    { dir: "auth-migrations", manifest: manifest({ name: "@santi020k/auth-migrations" }) },
  ];
  const config = {
    fixed: [["@santi020k/auth-cloudflare", "@santi020k/auth-migrations"]],
    ignore: [],
  };

  void it("passes when the fixed group exactly matches packages on disk with equal versions", () => {
    assert.deepEqual(validateFixedGroupCoherence(packages, config), []);
  });

  void it("flags a package missing from the fixed group", () => {
    const issues = validateFixedGroupCoherence(packages, { ...config, fixed: [["@santi020k/auth-cloudflare"]] });
    assert.ok(issues.some((issue) => issue.includes("missing from the .changeset/config.json fixed group")));
  });

  void it("flags version drift inside the fixed group", () => {
    const drifted = [packages[0], { ...packages[1], manifest: { ...packages[1].manifest, version: "0.2.0" } }];
    const issues = validateFixedGroupCoherence(drifted, config);
    assert.ok(issues.some((issue) => issue.includes("drifted out of lockstep")));
  });

  void it("flags an internal dependency that escapes the fixed group", () => {
    const issues = validateFixedGroupCoherence(packages, {
      ...config,
      fixed: [["@santi020k/auth-cloudflare"]],
      ignore: ["@santi020k/auth-migrations"],
    });
    assert.ok(issues.some((issue) => issue.includes('depends on workspace package "@santi020k/auth-migrations"')));
  });
});
