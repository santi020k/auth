import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertTarballFiles } from "./pack.mjs";

function pkg(overrides = {}) {
  return {
    dir: "auth-example",
    manifest: { main: "./dist/index.js", name: "@santi020k/auth-example", types: "./dist/index.d.ts", ...overrides },
  };
}

void describe("assertTarballFiles", () => {
  void it("accepts a tarball containing exactly the built entry points", () => {
    const files = [
      { path: "package.json" },
      { path: "dist/index.js" },
      { path: "dist/index.d.ts" },
      { path: "README.md" },
    ];
    assert.deepEqual(assertTarballFiles(files, pkg()), []);
  });

  void it("flags a missing main or types entry point", () => {
    const files = [{ path: "package.json" }, { path: "dist/index.js" }];
    const issues = assertTarballFiles(files, pkg());
    assert.ok(issues.some((issue) => issue.includes('"types" entry point')));
  });

  void it("flags a missing command entry point", () => {
    const files = [{ path: "package.json" }, { path: "dist/index.js" }, { path: "dist/index.d.ts" }];
    const issues = assertTarballFiles(files, pkg({ bin: { example: "./dist/cli.js" } }));
    assert.ok(issues.some((issue) => issue.includes('"bin" entry point (dist/cli.js)')));
  });

  void it("flags source or test files leaking into the tarball", () => {
    const files = [
      { path: "package.json" },
      { path: "dist/index.js" },
      { path: "dist/index.d.ts" },
      { path: "src/index.ts" },
    ];
    const issues = assertTarballFiles(files, pkg());
    assert.ok(issues.some((issue) => issue.includes('unexpectedly includes "src/index.ts"')));
  });
});
