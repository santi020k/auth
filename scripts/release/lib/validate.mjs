import { internalDependencyNames } from "./packages.mjs";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function metadataRules(manifest, pkg, label, requirePublishable) {
  const expectedDirectory = `packages/${pkg.dir}`;
  return [
    {
      message: `${label}: name must be scoped under "@santi020k/"`,
      valid: typeof manifest.name === "string" && manifest.name.startsWith("@santi020k/"),
    },
    {
      message: `${label}: version "${String(manifest.version)}" is not valid semver`,
      valid: typeof manifest.version === "string" && SEMVER_PATTERN.test(manifest.version),
    },
    { message: `${label}: license must be "MIT"`, valid: manifest.license === "MIT" },
    {
      message: `${label}: repository.directory must be "${expectedDirectory}"`,
      valid: manifest.repository?.directory === expectedDirectory,
    },
    {
      message: `${label}: publishConfig.access must be "public"`,
      valid: manifest.publishConfig?.access === "public",
    },
    {
      message: `${label}: publishConfig.provenance must stay false while the repository is private`,
      valid: manifest.publishConfig?.provenance === false,
    },
    { message: `${label}: main must be "./dist/index.js"`, valid: manifest.main === "./dist/index.js" },
    { message: `${label}: types must be "./dist/index.d.ts"`, valid: manifest.types === "./dist/index.d.ts" },
    {
      message: `${label}: files must include "dist"`,
      valid: Array.isArray(manifest.files) && manifest.files.includes("dist"),
    },
    {
      message: `${label}: still private; publication is blocked until the two-consumer production gate passes`,
      valid: !requirePublishable || manifest.private !== true,
    },
  ];
}

export function validatePackageMetadata(pkg, options = {}) {
  const { requirePublishable = false } = options;
  const manifest = pkg.manifest;
  const label = typeof manifest.name === "string" ? manifest.name : pkg.dir;

  return metadataRules(manifest, pkg, label, requirePublishable)
    .filter((rule) => !rule.valid)
    .map((rule) => rule.message);
}

function missingFromFixedGroupIssues(publishableOnDisk, declared) {
  return [...publishableOnDisk]
    .filter((name) => !declared.has(name))
    .map((name) => `${name}: publishable package is missing from the .changeset/config.json fixed group`);
}

function staleFixedGroupEntryIssues(declared, publishableOnDisk) {
  return [...declared]
    .filter((name) => !publishableOnDisk.has(name))
    .map((name) => `${name}: listed in the fixed group but no longer exists under packages/*`);
}

function versionDriftIssues(declared, byName) {
  const versions = new Set(
    [...declared].filter((name) => byName.has(name)).map((name) => byName.get(name).manifest.version),
  );
  return versions.size > 1
    ? [`Fixed group versions have drifted out of lockstep: ${[...versions].sort().join(", ")}`]
    : [];
}

function escapedDependencyIssues(declared, byName) {
  const knownNames = new Set(byName.keys());
  const issues = [];
  for (const name of declared) {
    const pkg = byName.get(name);
    if (!pkg) continue;
    for (const dependencyName of internalDependencyNames(pkg.manifest, knownNames)) {
      if (!declared.has(dependencyName)) {
        issues.push(`${name}: depends on workspace package "${dependencyName}", which is not in the fixed group`);
      }
    }
  }
  return issues;
}

export function validateFixedGroupCoherence(packages, changesetConfig) {
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const ignored = new Set(changesetConfig.ignore ?? []);
  const publishableOnDisk = new Set([...byName.keys()].filter((name) => !ignored.has(name)));

  const fixedGroups = changesetConfig.fixed ?? [];
  const privatePackageIssues =
    changesetConfig.privatePackages?.version === true && changesetConfig.privatePackages?.tag === false
      ? []
      : [
          ".changeset/config.json must version private packages without tagging them while the two-consumer gate remains closed",
        ];
  if (fixedGroups.length !== 1) {
    return [
      ...privatePackageIssues,
      `.changeset/config.json "fixed" must declare exactly one release group, found ${fixedGroups.length}`,
    ];
  }

  const declared = new Set(fixedGroups[0]);
  return [
    ...privatePackageIssues,
    ...missingFromFixedGroupIssues(publishableOnDisk, declared),
    ...staleFixedGroupEntryIssues(declared, publishableOnDisk),
    ...versionDriftIssues(declared, byName),
    ...escapedDependencyIssues(declared, byName),
  ];
}
