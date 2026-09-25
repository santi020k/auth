import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertTarballFiles, packPackage } from "./lib/pack.mjs";
import { readWorkspacePackages, topologicalOrder } from "./lib/packages.mjs";
import { validateFixedGroupCoherence, validatePackageMetadata } from "./lib/validate.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const packagesRoot = join(repoRoot, "packages");
const changesetConfig = JSON.parse(readFileSync(join(repoRoot, ".changeset", "config.json"), "utf8"));

const packages = readWorkspacePackages(packagesRoot);
const issues = [];

for (const pkg of packages) {
  issues.push(...validatePackageMetadata(pkg, { requirePublishable: false }));
}
issues.push(...validateFixedGroupCoherence(packages, changesetConfig));

let order;
try {
  order = topologicalOrder(packages);
} catch (error) {
  issues.push(error instanceof Error ? error.message : String(error));
  order = [];
}

if (order.length > 0) {
  const packDir = mkdtempSync(join(tmpdir(), "auth-release-pack-"));
  try {
    for (const pkg of order) {
      const packed = packPackage(join(packagesRoot, pkg.dir), packDir);
      issues.push(...assertTarballFiles(packed.files, pkg));
    }
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

if (issues.length > 0) {
  process.stderr.write("Release readiness check failed:\n");
  for (const issue of issues) process.stderr.write(`  - ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release metadata, Changesets coherence, and pack contents are correct for ${order.length} package(s) in dependency order:\n`,
  );
  for (const pkg of order) process.stdout.write(`  ${pkg.manifest.name}@${pkg.manifest.version}\n`);
}
