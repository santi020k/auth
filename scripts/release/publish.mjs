import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { packPackage } from "./lib/pack.mjs";
import { readWorkspacePackages, topologicalOrder } from "./lib/packages.mjs";
import {
  createAndPushTag,
  npmView,
  planPublish,
  planTag,
  remoteTagCommit,
  waitForNpmVersion,
} from "./lib/registry.mjs";
import { validateFixedGroupCoherence, validatePackageMetadata } from "./lib/validate.mjs";

const dryRun = process.argv.includes("--dry-run");
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const packagesRoot = join(repoRoot, "packages");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function loadReleasableOrder() {
  const changesetConfig = JSON.parse(readFileSync(join(repoRoot, ".changeset", "config.json"), "utf8"));
  const packages = readWorkspacePackages(packagesRoot);

  const metadataIssues = packages.flatMap((pkg) => validatePackageMetadata(pkg, { requirePublishable: true }));
  const coherenceIssues = validateFixedGroupCoherence(packages, changesetConfig);
  if (metadataIssues.length > 0 || coherenceIssues.length > 0) {
    throw new Error([...metadataIssues, ...coherenceIssues].join("\n"));
  }

  return topologicalOrder(packages);
}

function checkReleaseBranch(version) {
  if ((process.env.GITHUB_EVENT_NAME ?? "") !== "pull_request") return;

  const releaseBranch = process.env.RELEASE_BRANCH ?? "";
  const expectedBranch = `release/v${version}`;
  if (releaseBranch !== expectedBranch) {
    throw new Error(`Expected release branch ${expectedBranch}, received ${releaseBranch}.`);
  }
}

// Decide what a package needs without mutating anything: pack it, compare integrity against the
// registry, but never publish here. planPackage failures are collected across the whole dependency
// order before any package is published, so a problem found late does not leave earlier packages
// published with no way to bring the rest of the fixed group along.
function planPackage(pkg, packDir) {
  const pkgDir = join(packagesRoot, pkg.dir);
  const spec = `${pkg.manifest.name}@${pkg.manifest.version}`;

  if (npmView(pkg.manifest.name, "name") === null) {
    throw new Error(
      `${pkg.manifest.name} does not exist on npm yet. Its initial publication must be completed manually ` +
        "after the production-readiness gate, then this workflow can be rerun to reconcile tags and future OIDC releases.",
    );
  }

  const packed = packPackage(pkgDir, packDir);
  const registryVersion = npmView(spec, "version");
  const registryIntegrity = registryVersion ? npmView(spec, "dist.integrity") : null;
  const decision = planPublish({
    localIntegrity: packed.integrity,
    registryVersionExists: registryVersion !== null,
    registryIntegrity,
  });

  if (decision === "error-mismatch") {
    throw new Error(
      `${spec} exists on npm, but its integrity does not match the package built from this commit. ` +
        "Refusing to create source tags or a GitHub Release.",
    );
  }

  return { decision, pkg, spec, tarballPath: packed.tarballPath };
}

function buildPublishPlan(order, packDir) {
  const plan = [];
  const blockingIssues = [];

  for (const pkg of order) {
    try {
      plan.push(planPackage(pkg, packDir));
    } catch (error) {
      blockingIssues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (blockingIssues.length > 0) {
    throw new Error(blockingIssues.join("\n"));
  }
  return plan;
}

function publishEntry(entry) {
  if (entry.decision !== "publish") {
    log(`${entry.spec} already published with matching integrity; skipping publish.`);
    return;
  }

  log(`Publishing ${entry.spec}`);
  // Publish the exact tarball whose integrity was checked during planning. Publishing
  // the directory would repack it and could make the registry artifact differ from
  // the bytes approved above.
  const publishResult = spawnSync("pnpm", ["publish", entry.tarballPath, "--access", "public", "--no-git-checks"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (publishResult.status !== 0) {
    throw new Error(`pnpm publish failed for ${entry.spec}.`);
  }

  const published = waitForNpmVersion(entry.spec, entry.pkg.manifest.version, {
    onRetry: ({ attempt, attempts }) => log(`Waiting for ${entry.spec} on npm (${attempt}/${attempts}).`),
  });
  if (!published) {
    throw new Error(`${entry.spec} did not verify on npm after publishing.`);
  }
  log(`Verified ${entry.spec} on npm.`);
}

function ensureTag(tagName, releaseCommit) {
  const { tagExists, remoteCommit } = remoteTagCommit(tagName);
  const decision = planTag({ releaseCommit, remoteCommit, tagExists });
  if (decision === "conflict") {
    throw new Error(`Tag ${tagName} already points to ${remoteCommit}, expected ${releaseCommit}.`);
  }
  if (decision === "already-correct") {
    log(`Tag ${tagName} already points to the release commit.`);
    return;
  }
  createAndPushTag(tagName, `Release ${tagName}`);
  log(`Created tag ${tagName}.`);
}

function tagRelease(version, plan) {
  const releaseCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  execFileSync("git", ["config", "user.name", "github-actions[bot]"]);
  execFileSync("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);

  ensureTag(`v${version}`, releaseCommit);
  for (const entry of plan) ensureTag(entry.spec, releaseCommit);

  return releaseCommit;
}

function publishGithubRelease(version) {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const repositoryTag = `v${version}`;
  const releaseView = spawnSync("gh", ["release", "view", repositoryTag, "--repo", repository], { stdio: "ignore" });
  if (releaseView.status === 0) {
    log(`GitHub Release ${repositoryTag} already exists.`);
    return;
  }

  const create = spawnSync(
    "gh",
    [
      "release",
      "create",
      repositoryTag,
      "--repo",
      repository,
      "--title",
      repositoryTag,
      "--verify-tag",
      "--generate-notes",
    ],
    { stdio: "inherit" },
  );
  if (create.status !== 0) {
    throw new Error(`Failed to create GitHub Release ${repositoryTag}.`);
  }
}

function writeSummary(releaseCommit, plan) {
  const summaryLines = [`Published at ${releaseCommit}:`, ...plan.map((entry) => `- ${entry.spec}`), ""].join("\n");
  log(`\n${summaryLines}`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, summaryLines);
}

function run() {
  const order = loadReleasableOrder();
  const version = order[0].manifest.version;
  checkReleaseBranch(version);

  log(`Releasing ${order.length} package(s) at v${version} in dependency order:`);
  for (const pkg of order) log(`  ${pkg.manifest.name}`);

  const packDir = mkdtempSync(join(tmpdir(), "auth-release-publish-"));
  try {
    const plan = buildPublishPlan(order, packDir);
    for (const entry of plan) {
      log(`${entry.spec}: ${entry.decision === "publish" ? "will publish" : "already published, matches"}`);
    }

    if (dryRun) {
      log("\nDry run complete; no packages were published and no tags were created.");
      return;
    }

    for (const entry of plan) publishEntry(entry);

    const releaseCommit = tagRelease(version, plan);
    publishGithubRelease(version);
    writeSummary(releaseCommit, plan);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
