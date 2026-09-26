import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const DISALLOWED_PREFIXES = ["src/", "tests/", "dist-test/", "node_modules/"];

function normalizedStringEntry(value) {
  return typeof value === "string" ? value.replace(/^\.\//u, "") : undefined;
}

function binEntries(manifest) {
  if (typeof manifest.bin === "string") {
    return [manifest.bin];
  }
  if (manifest.bin && typeof manifest.bin === "object") {
    return Object.values(manifest.bin).filter((value) => typeof value === "string");
  }
  return [];
}

function missingEntryIssue(paths, label, kind, entry) {
  if (entry === undefined || paths.has(entry)) {
    return [];
  }
  return [`${label}: packed tarball is missing the "${kind}" entry point (${entry})`];
}

function missingEntryPointIssues(paths, manifest, label) {
  const issues = [
    ...missingEntryIssue(paths, label, "main", normalizedStringEntry(manifest.main)),
    ...missingEntryIssue(paths, label, "types", normalizedStringEntry(manifest.types)),
  ];
  for (const binEntry of binEntries(manifest)) {
    const normalized = binEntry.replace(/^\.\//u, "");
    if (!paths.has(normalized)) {
      issues.push(`${label}: packed tarball is missing a "bin" entry point (${normalized})`);
    }
  }
  return issues;
}

function disallowedFileIssues(paths, label) {
  return [...paths]
    .filter((path) => DISALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .map((path) => `${label}: packed tarball unexpectedly includes "${path}"`);
}

export function assertTarballFiles(files, pkg) {
  const manifest = pkg.manifest;
  const label = manifest.name ?? pkg.dir;
  const paths = new Set(files.map((file) => file.path));

  return [
    ...(paths.has("package.json") ? [] : [`${label}: packed tarball is missing package.json`]),
    ...missingEntryPointIssues(paths, manifest, label),
    ...disallowedFileIssues(paths, label),
  ];
}

export function packPackage(pkgDir, destinationDir) {
  const result = spawnSync("pnpm", ["pack", "--json", "--pack-destination", destinationDir], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`pnpm pack failed in ${pkgDir}:\n${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout);
  const tarballPath = parsed.filename;
  const contents = readFileSync(tarballPath);
  const integrity = `sha512-${createHash("sha512").update(contents).digest("base64")}`;
  const sha256 = createHash("sha256").update(contents).digest("hex");
  return { tarballPath, files: parsed.files ?? [], integrity, sha256 };
}

export function readPackedManifest(tarballPath) {
  const result = spawnSync("tar", ["-xOf", tarballPath, "package/package.json"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Could not read package.json from ${tarballPath}:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

export function unresolvedProtocolIssues(manifest) {
  const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const issues = [];
  for (const field of fields) {
    const dependencies = manifest[field];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string" && /^(?:catalog|file|link|workspace):/u.test(range)) {
        issues.push(`${manifest.name}: packed ${field}.${name} still uses ${range}`);
      }
    }
  }
  return issues;
}
