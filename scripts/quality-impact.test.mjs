import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { gitEnvironment } from "./ci-affected.mjs";

test("Quality v2 preserves authentication-wide fallback and downstream browser selection", () => {
  const cwd = mkdtempSync(join(tmpdir(), "auth-impact-"));
  const env = gitEnvironment();
  const git = (...args) => execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString().trim();
  const plan = (base) =>
    JSON.parse(
      execFileSync(
        process.env.QUALITY_BIN || "quality",
        ["impact", "plan", "--base", base, "--head", "HEAD", "--format", "json"],
        { cwd, env, encoding: "utf8" },
      ),
    );
  try {
    git("init", "-q");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "ci@example.test");
    copyFileSync(new URL("../quality-impact.json", import.meta.url), join(cwd, "quality-impact.json"));
    git("add", ".");
    git("commit", "-qm", "initial policy");
    const all = ["packages", "playground", "security", "website", "website-browser"];
    for (const [path, selected] of [
      ["apps/website/src/page.astro", ["packages", "security", "website", "website-browser"]],
      ["apps/playground/src/index.ts", ["packages", "playground", "security"]],
      ["packages/auth-client/src/index.ts", all],
      ["apps/website/package.json", all],
      ["pnpm-lock.yaml", all],
      ["unknown.txt", all],
    ]) {
      const base = git("rev-parse", "HEAD");
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), "fixture\n");
      git("add", ".");
      git("commit", "-qm", "change fixture");
      assert.deepEqual(
        plan(base)
          .selected.map((node) => node.id)
          .sort(),
        selected,
        path,
      );
    }
    assert.equal(plan("unavailable-ref").selected.length, all.length);
    const base = git("rev-parse", "HEAD");
    git("rm", "packages/auth-client/src/index.ts");
    git("commit", "-qm", "delete shared source");
    assert.equal(plan(base).selected.length, all.length);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
