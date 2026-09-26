import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { after, before, describe, it } from "node:test";

import { createStaticServer } from "./serve-static.mjs";

let root;
let server;
let baseURL;

before(async () => {
  root = `${await mkdtemp(join(tmpdir(), "serve-static-test-"))}${sep}`;
  await writeFile(join(root, "index.html"), "<!doctype html><title>home</title>");
  // Deliberately no 404.html in this fixture root, to exercise the missing-fallback-file path.
  server = createStaticServer(root);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

void describe("static preview server", () => {
  void it("serves an existing file", async () => {
    const response = await fetch(`${baseURL}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /home/u);
  });

  void it("returns a plain 404 when the custom fallback is missing and keeps serving", async () => {
    const missing = await fetch(`${baseURL}/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "Not found");
    const followUp = await fetch(`${baseURL}/`);
    assert.equal(followUp.status, 200);
  });
});
