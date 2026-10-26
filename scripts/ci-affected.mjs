import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const applications = [
  { directory: "apps/website/", name: "@santi020k/auth-website" },
  { directory: "apps/playground/", name: "@santi020k/auth-playground" },
];
const compatibilityCommands = ["build", "typecheck", "test", "check:package"].map((script) => [
  "--filter",
  "./packages/*",
  "run",
  script,
]);
export const gitEnvironment = (environment = process.env) =>
  Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith("GIT_")));
export const packageManagerInvocation = (entrypoint, arguments_) =>
  /\.(?:c|m)?js$/u.test(entrypoint)
    ? { executable: process.execPath, arguments: [entrypoint, ...arguments_] }
    : { executable: entrypoint, arguments: arguments_ };
const git = (cwd, arguments_) =>
  execFileSync("git", arguments_, {
    cwd,
    env: gitEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

export const changedFiles = (cwd, base) => {
  const revision = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]).trim();
  const ancestor = git(cwd, ["merge-base", revision, "HEAD"]).trim();
  const commands = [
    ["diff", "--no-renames", "--name-only", "-z", ancestor, "HEAD"],
    ["diff", "--no-renames", "--name-only", "-z", "--cached"],
    ["diff", "--no-renames", "--name-only", "-z"],
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ];
  return [...new Set(commands.flatMap((command) => git(cwd, command).split("\0").filter(Boolean)))].sort();
};

export const classify = (files) => {
  if (
    files.some(
      (file) =>
        file.endsWith("/package.json") || !applications.some((application) => file.startsWith(application.directory)),
    )
  )
    return null;
  return applications
    .filter((application) => files.some((file) => file.startsWith(application.directory)))
    .map((application) => application.name);
};

const fullPlan = (reason) => ({
  mode: "full",
  reason,
  browser: true,
  commands: [["run", "verify"]],
  compatibilityCommands,
});
const appCommands = (name) =>
  ["build", "typecheck", "test", "test:e2e"].map((script) => ["--filter", name, "run", script]);
const affectedPlan = (selected) => ({
  mode: "affected",
  selected,
  browser: selected.length > 0,
  reason:
    "Application-only changes use pnpm filters; authentication packages and shared files retain full verification",
  commands: [
    ["--filter", "./packages/*", "run", "build"],
    ["run", "format:check"],
    ["run", "lint"],
    ...selected.flatMap(appCommands),
    ...(selected.includes("@santi020k/auth-website") ? [["run", "check:seo"]] : []),
    ["run", "test:ci"],
    ["run", "check:security"],
  ],
  compatibilityCommands: [],
});

const fullEvent = (full, event) => Boolean(full || (event && event !== "pull_request"));

export const createPlan = ({ cwd = process.cwd(), base, full = false, env = process.env }) => {
  if (fullEvent(full, env.GITHUB_EVENT_NAME)) return fullPlan("Full validation requested by the event or caller");
  try {
    const head = env.GITHUB_HEAD_REF || git(cwd, ["branch", "--show-current"]).trim();
    if (/^(release\/|changeset-release\/)/u.test(head) || !base)
      return fullPlan("Release branch or missing comparison base");
    const selected = classify(changedFiles(cwd, base));
    return selected
      ? affectedPlan(selected)
      : fullPlan("Authentication package, manifest, shared, or unknown path changed");
  } catch {
    return fullPlan("Git comparison could not be verified");
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      full: { type: "boolean" },
      plan: { type: "boolean" },
      compatibility: { type: "boolean" },
    },
  });
  const plan = createPlan({ base: values.base || process.env.QUALITY_CI_BASE, full: values.full });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `browser=${plan.browser}\nmode=${plan.mode}\n`);
  if (!values.plan) {
    if (!process.env.npm_execpath) throw new Error("Run through the repository package manager");
    for (const command of values.compatibility ? plan.compatibilityCommands : plan.commands) {
      const invocation = packageManagerInvocation(process.env.npm_execpath, command);
      const result = spawnSync(invocation.executable, invocation.arguments, { stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        process.exitCode = result.status || 1;
        break;
      }
    }
  }
}
