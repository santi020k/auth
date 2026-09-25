import { execFileSync, spawnSync } from "node:child_process";

export function planPublish({ localIntegrity, registryVersionExists, registryIntegrity }) {
  if (!registryVersionExists) return "publish";
  if (registryIntegrity && registryIntegrity === localIntegrity) return "skip-matches";
  return "error-mismatch";
}

export function planTag({ tagExists, remoteCommit, releaseCommit }) {
  if (!tagExists) return "create";
  if (remoteCommit === releaseCommit) return "already-correct";
  return "conflict";
}

export function npmView(spec, field) {
  const result = spawnSync("npm", ["view", spec, field], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`;
    if (/\bE404\b|404 Not Found/iu.test(diagnostic)) return null;
    throw new Error(`npm view failed for ${spec} (${field}); refusing to infer registry state.`);
  }
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

export function parseRemoteTagOutput(output) {
  const refs = new Map(
    output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [commit, ref] = line.split(/\s+/u);
        return [ref, commit];
      }),
  );
  const peeled = [...refs.entries()].find(([ref]) => ref?.endsWith("^{}"));
  const direct = [...refs.entries()].find(([ref]) => !ref?.endsWith("^{}"));
  return peeled?.[1] ?? direct?.[1] ?? null;
}

export function remoteTagCommit(tagName) {
  const ref = `refs/tags/${tagName}`;
  const lsRemote = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", ref, `${ref}^{}`], {
    encoding: "utf8",
  });
  if (lsRemote.error) throw lsRemote.error;
  if (lsRemote.status === 2) return { tagExists: false, remoteCommit: null };
  if (lsRemote.status !== 0) {
    throw new Error(`Unable to inspect remote tag ${tagName}; refusing to infer tag state.`);
  }

  const commit = parseRemoteTagOutput(lsRemote.stdout);
  if (commit === null) throw new Error(`Remote tag ${tagName} returned no commit.`);
  return { tagExists: true, remoteCommit: commit };
}

export function createAndPushTag(tagName, message) {
  execFileSync("git", ["tag", "-a", tagName, "-m", message]);
  execFileSync("git", ["push", "origin", `refs/tags/${tagName}`]);
}
