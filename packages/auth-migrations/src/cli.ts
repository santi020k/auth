#!/usr/bin/env node
import { nodeCliIO, runAuthMigrationsCli } from "./cli-lib.js";

async function main(): Promise<void> {
  process.exitCode = await runAuthMigrationsCli(process.argv.slice(2), nodeCliIO);
}

void main();
