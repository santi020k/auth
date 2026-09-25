import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Only relationships that survive in a published manifest affect registry order.
// A workspace-only devDependency can be needed to build or test the repository,
// but forcing it into publish order can create artificial cycles.
const INTERNAL_DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

export function readWorkspacePackages(packagesRoot) {
  const packages = [];
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesRoot, entry.name, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (typeof manifest.name !== "string") continue;
    packages.push({ dir: entry.name, manifestPath, manifest });
  }
  return packages;
}

export function internalDependencyNames(manifest, knownNames) {
  const names = new Set();
  for (const field of INTERNAL_DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [depName, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:") && knownNames.has(depName)) {
        names.add(depName);
      }
    }
  }
  return names;
}

export function topologicalOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const knownNames = new Set(byName.keys());
  const dependsOn = new Map(
    packages.map((pkg) => [pkg.manifest.name, internalDependencyNames(pkg.manifest, knownNames)]),
  );

  const ordered = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(name, chain) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular workspace dependency detected: ${[...chain, name].join(" -> ")}`);
    }
    visiting.add(name);
    for (const dependency of dependsOn.get(name) ?? []) {
      visit(dependency, [...chain, name]);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(byName.get(name));
  }

  for (const name of [...knownNames].sort()) {
    visit(name, []);
  }

  return ordered;
}
