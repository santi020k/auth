import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createOwnerAuthClient } from "../src/client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

void describe("owner auth browser client", () => {
  void it("sends credentialed requests to a split-origin auth server", async () => {
    let request: Request | undefined;
    globalThis.fetch = (input, init): Promise<Response> => {
      request = new Request(input, init);
      return Promise.resolve(Response.json(null));
    };

    const client = createOwnerAuthClient({ authServerURL: "https://api.example.com" });
    await client.getSession();

    assert.ok(request);
    assert.equal(request.url, "https://api.example.com/api/auth/get-session");
    assert.equal(request.credentials, "include");
  });

  void it("supports a custom auth base path", async () => {
    let request: Request | undefined;
    globalThis.fetch = (input, init): Promise<Response> => {
      request = new Request(input, init);
      return Promise.resolve(Response.json(null));
    };

    const client = createOwnerAuthClient({
      authServerURL: "http://127.0.0.1:8787",
      basePath: "/internal/owner-auth",
    });
    await client.getSession();

    assert.ok(request);
    assert.equal(request.url, "http://127.0.0.1:8787/internal/owner-auth/get-session");
    assert.equal(request.credentials, "include");
  });

  void it("rejects unsafe or ambiguous server URLs and paths", () => {
    assert.throws(
      () => createOwnerAuthClient({ authServerURL: "http://api.example.com" }),
      /owner_auth_server_url_invalid/u,
    );
    assert.throws(
      () => createOwnerAuthClient({ authServerURL: "https://api.example.com/api/auth" }),
      /owner_auth_server_url_invalid/u,
    );
    assert.throws(
      () => createOwnerAuthClient({ authServerURL: "https://api.example.com", basePath: "/api//auth" }),
      /owner_auth_base_path_invalid/u,
    );
  });
});
