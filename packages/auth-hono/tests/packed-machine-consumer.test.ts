import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface PackResult {
  filename: string;
}

function packResult(value: unknown): PackResult {
  if (typeof value !== "object" || value === null || !("filename" in value) || typeof value.filename !== "string") {
    throw new Error("packed_machine_consumer_metadata_invalid");
  }
  return { filename: value.filename };
}

async function pack(packageDirectory: string, destination: string): Promise<string> {
  const { stdout } = await execFileAsync("pnpm", ["pack", "--pack-destination", destination, "--json"], {
    cwd: packageDirectory,
  });
  return resolve(destination, packResult(JSON.parse(stdout) as unknown).filename);
}

void describe("packed machine-auth consumer", () => {
  void it("installs and typechecks the public machine and Hono contracts outside the workspace", async () => {
    const honoDirectory = process.cwd();
    const machineDirectory = resolve(honoDirectory, "../auth-machine");
    const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "auth-machine-consumer-"));
    try {
      const machineTarball = await pack(machineDirectory, temporaryDirectory);
      const honoTarball = await pack(honoDirectory, temporaryDirectory);
      assert.ok((await readFile(machineTarball)).byteLength > 0);
      assert.ok((await readFile(honoTarball)).byteLength > 0);
      await writeFile(
        resolve(temporaryDirectory, "package.json"),
        JSON.stringify({ name: "auth-machine-clean-consumer", private: true, type: "module" }),
      );
      await execFileAsync(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", machineTarball, honoTarball, "hono@4.13.9"],
        { cwd: temporaryDirectory },
      );
      await writeFile(
        resolve(temporaryDirectory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: "ES2023",
          },
          include: ["consumer.ts"],
        }),
      );
      await writeFile(
        resolve(temporaryDirectory, "consumer.ts"),
        `import { createRequireHonoMachineAuth } from "@santi020k/auth-hono";
import { listMachineCredentialInventory, resolveMachineBearer, revokeMachineCredential, rotateMachineCredential, type MachineCredentialRecord } from "@santi020k/auth-machine";

declare const record: MachineCredentialRecord;
declare const request: Request;
void resolveMachineBearer(request, async (credentialId) => credentialId === record.credentialId ? record : null);
void createRequireHonoMachineAuth({
  requiredScopes: ["reports:read"],
  resolveCredential: (_context, credentialId) => credentialId === record.credentialId ? record : null,
});
void listMachineCredentialInventory([record]);
void revokeMachineCredential(record);
void rotateMachineCredential(record, {
  expiresAt: "2028-01-01T00:00:00Z",
  newCredentialId: "reports-2",
  retirePreviousAt: "2027-01-01T00:00:00Z",
});
`,
      );
      await execFileAsync(resolve(honoDirectory, "node_modules/.bin/tsc"), ["--project", "tsconfig.json"], {
        cwd: temporaryDirectory,
      });
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
