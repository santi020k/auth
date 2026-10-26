import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { changedFiles, classify, createPlan, gitEnvironment, packageManagerInvocation } from "./ci-affected.mjs";

test("the repository package manager can be a native executable or JavaScript entrypoint", () => {
  const arguments_ = ["run", "verify"];
  for (const executable of ["/tools/pnpm-native", "C:\\tools\\pnpm.exe"])
    assert.deepEqual(packageManagerInvocation(executable, arguments_), { executable, arguments: arguments_ });
  for (const entrypoint of ["/tools/pnpm.cjs", "/tools/pnpm.js"])
    assert.deepEqual(packageManagerInvocation(entrypoint, arguments_), {
      executable: process.execPath,
      arguments: [entrypoint, ...arguments_],
    });
});

test("application checks stay separate while authentication and unknown changes remain full", () => {
  assert.deepEqual(classify(["apps/website/src/pages/index.astro"]), ["@santi020k/auth-website"]);
  assert.deepEqual(classify(["apps/playground/src/client.ts"]), ["@santi020k/auth-playground"]);
  assert.deepEqual(classify(["apps/website/src/index.astro", "apps/playground/src/client.ts"]), [
    "@santi020k/auth-website",
    "@santi020k/auth-playground",
  ]);
  assert.deepEqual(classify([]), []);
  assert.equal(classify(["packages/auth-client/src/index.ts"]), null);
  for (const file of [
    "pnpm-lock.yaml",
    "quality.yml",
    "scripts/release/check.mjs",
    "new-area/file.ts",
    "apps/website/package.json",
    " apps/website/src/index.astro",
  ])
    assert.equal(classify([file]), null);
});

test("release, manual, push, missing base and unavailable history retain full verification", () => {
  for (const input of [
    { full: true },
    {},
    { base: "missing", env: { GITHUB_HEAD_REF: "ci/test" } },
    { base: "HEAD", env: { GITHUB_HEAD_REF: "release/v0.5.1" } },
    { base: "HEAD", env: { GITHUB_EVENT_NAME: "push" } },
    { base: "HEAD", env: { GITHUB_EVENT_NAME: "workflow_dispatch" } },
  ]) {
    const plan = createPlan(input);
    assert.equal(plan.mode, "full");
    assert.deepEqual(plan.commands, [["run", "verify"]]);
    assert.equal(plan.compatibilityCommands.length, 4);
    assert.equal(plan.browser, true);
  }
});

test("Git comparison includes deleted and renamed paths plus local edits under hook overrides", () => {
  const directory = mkdtempSync(join(tmpdir(), "auth-affected-"));
  const git = (...args) => execFileSync("git", args, { cwd: directory, env: gitEnvironment(), stdio: "pipe" });
  const original = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")));
  try {
    Object.assign(process.env, {
      GIT_DIR: "/missing/git",
      GIT_WORK_TREE: "/missing/tree",
      GIT_INDEX_FILE: "/missing/index",
    });
    git("init", "--quiet");
    git("config", "user.name", "CI fixture");
    git("config", "user.email", "ci@example.test");
    mkdirSync(join(directory, "apps/website"), { recursive: true });
    for (const name of ["deleted", "renamed", "staged", "unstaged"])
      writeFileSync(join(directory, "apps/website", name), "before");
    git("add", ".");
    git("commit", "-m", "fixture");
    git("rm", "apps/website/deleted");
    git("mv", "apps/website/renamed", "apps/website/moved");
    writeFileSync(join(directory, "apps/website/staged"), "after");
    git("add", "apps/website/staged");
    writeFileSync(join(directory, "apps/website/unstaged"), "after");
    writeFileSync(join(directory, "apps/website/untracked"), "new");
    assert.deepEqual(changedFiles(directory, "HEAD"), [
      "apps/website/deleted",
      "apps/website/moved",
      "apps/website/renamed",
      "apps/website/staged",
      "apps/website/unstaged",
      "apps/website/untracked",
    ]);
    const plan = createPlan({ cwd: directory, base: "HEAD", env: { GITHUB_HEAD_REF: "ci/test" } });
    assert.equal(plan.mode, "affected");
    assert.deepEqual(plan.selected, ["@santi020k/auth-website"]);
    assert.deepEqual(plan.compatibilityCommands, []);
    assert.ok(plan.commands.some((command) => command.includes("check:security")));
    mkdirSync(join(directory, " apps/website"), { recursive: true });
    writeFileSync(join(directory, " apps/website/file"), "unknown root");
    assert.ok(changedFiles(directory, "HEAD").includes(" apps/website/file"));
    assert.equal(createPlan({ cwd: directory, base: "HEAD", env: { GITHUB_HEAD_REF: "ci/test" } }).mode, "full");
  } finally {
    for (const key of Object.keys(process.env).filter((key) => key.startsWith("GIT_"))) delete process.env[key];
    Object.assign(process.env, original);
    rmSync(directory, { recursive: true, force: true });
  }
});
