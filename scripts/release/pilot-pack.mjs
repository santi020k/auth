import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertTarballFiles, packPackage, readPackedManifest, unresolvedProtocolIssues } from "./lib/pack.mjs";
import { readWorkspacePackages, topologicalOrder } from "./lib/packages.mjs";
import { checksumFile, createPilotManifest, pilotOutputArgument } from "./lib/pilot.mjs";
import { validateFixedGroupCoherence, validatePackageMetadata } from "./lib/validate.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const packagesRoot = join(repoRoot, "packages");
const outputArgument = pilotOutputArgument(process.argv.slice(2));
const outputDir = isAbsolute(outputArgument) ? outputArgument : resolve(repoRoot, outputArgument);

function fail(message) {
  throw new Error(message);
}

function requireCleanSource() {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (status.trim() !== "") {
    fail("Pilot bundles must be generated from a clean committed revision.");
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function requireEmptyOutput() {
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    fail(`Pilot bundle output must be empty: ${outputDir}`);
  }
  mkdirSync(dirname(outputDir), { recursive: true });
}

function buildPackages() {
  for (const script of ["clean", "build"]) {
    const result = spawnSync("pnpm", ["--filter", "./packages/*", "run", script], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) fail(`Package ${script} failed; no pilot bundle was created.`);
  }
}

function createBundle(sourceCommit, destinationDir) {
  const changesetConfig = JSON.parse(readFileSync(join(repoRoot, ".changeset", "config.json"), "utf8"));
  const packages = readWorkspacePackages(packagesRoot);
  const issues = packages.flatMap((pkg) => validatePackageMetadata(pkg, { requirePublishable: false }));
  issues.push(...validateFixedGroupCoherence(packages, changesetConfig));
  const order = topologicalOrder(packages);
  const versions = new Set(order.map((pkg) => pkg.manifest.version));
  if (versions.size !== 1) issues.push("Pilot bundle packages must share one fixed-group version.");

  const packedPackages = [];
  for (const pkg of order) {
    const packed = packPackage(join(packagesRoot, pkg.dir), destinationDir);
    issues.push(...assertTarballFiles(packed.files, pkg));
    const packedManifest = readPackedManifest(packed.tarballPath);
    issues.push(...unresolvedProtocolIssues(packedManifest));
    packedPackages.push({
      filename: basename(packed.tarballPath),
      integrity: packed.integrity,
      manifest: packedManifest,
      name: pkg.manifest.name,
      sha256: packed.sha256,
      version: pkg.manifest.version,
    });
  }

  if (issues.length > 0) fail(issues.join("\n"));

  const version = order[0]?.manifest.version;
  if (typeof version !== "string") fail("No packages were found for the pilot bundle.");
  const manifest = createPilotManifest({ packages: packedPackages, sourceCommit, version });
  writeFileSync(join(destinationDir, "pilot-bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(destinationDir, "SHA256SUMS"), checksumFile(packedPackages));

  process.stdout.write(`Created private pilot bundle v${version} from ${sourceCommit} in ${outputDir}\n`);
  for (const entry of packedPackages) process.stdout.write(`  ${entry.filename}\n`);
}

function run() {
  const sourceCommit = requireCleanSource();
  requireEmptyOutput();
  buildPackages();

  const stagingDir = mkdtempSync(join(dirname(outputDir), `.${basename(outputDir)}.tmp-`));

  try {
    createBundle(sourceCommit, stagingDir);
    if (existsSync(outputDir)) rmdirSync(outputDir);
    renameSync(stagingDir, outputDir);
  } finally {
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true });
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
