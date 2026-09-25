const INTERNAL_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

export function pilotOutputArgument(args) {
  const values = args[0] === "--" ? args.slice(1) : args;
  if (values.length > 1) throw new Error("Usage: pnpm pilot:pack -- <empty-output-directory>");
  const value = values[0] ?? "dist/pilot-bundle";
  if (!value.trim() || value === "--") throw new Error("Pilot bundle output directory is invalid.");
  return value;
}

export function bundledDependencyNames(manifest, bundledNames) {
  const names = new Set();
  for (const field of INTERNAL_DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const name of Object.keys(dependencies)) {
      if (bundledNames.has(name)) names.add(name);
    }
  }
  return [...names].sort();
}

export function createPilotManifest({ packages, sourceCommit, version }) {
  const bundledNames = new Set(packages.map((entry) => entry.name));
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const overrideNames = new Set(packages.flatMap((entry) => bundledDependencyNames(entry.manifest, bundledNames)));
  return {
    schemaVersion: 1,
    kind: "@santi020k/auth-pilot-bundle",
    version,
    source: {
      commit: sourceCommit,
      repository: "https://github.com/santi020k/auth",
    },
    packages: packages.map((entry) => ({
      name: entry.name,
      version: entry.version,
      filename: entry.filename,
      sha256: entry.sha256,
      integrity: entry.integrity,
      bundledDependencies: bundledDependencyNames(entry.manifest, bundledNames),
    })),
    pnpmOverrideTargets: [...overrideNames].sort().map((name) => {
      const entry = byName.get(name);
      return {
        selector: `${name}@${entry.version}`,
        filename: entry.filename,
      };
    }),
  };
}

export function checksumFile(packages) {
  return `${packages.map((entry) => `${entry.sha256}  ${entry.filename}`).join("\n")}\n`;
}
