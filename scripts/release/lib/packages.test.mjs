import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { internalDependencyNames, topologicalOrder } from "./packages.mjs";

function pkg(name, dir, deps = {}) {
  return { dir, manifest: { dependencies: deps, name } };
}

void describe("internalDependencyNames", () => {
  void it("only counts workspace-protocol ranges for known packages", () => {
    const names = internalDependencyNames(
      { dependencies: { "@santi020k/auth-migrations": "workspace:*", "better-auth": "catalog:" } },
      new Set(["@santi020k/auth-migrations"]),
    );
    assert.deepEqual([...names], ["@santi020k/auth-migrations"]);
  });

  void it("ignores workspace ranges pointing outside the known set", () => {
    const names = internalDependencyNames(
      { dependencies: { "@santi020k/unrelated": "workspace:*" } },
      new Set(["@santi020k/auth-migrations"]),
    );
    assert.equal(names.size, 0);
  });

  void it("ignores development-only workspace relationships for publish ordering", () => {
    const names = internalDependencyNames(
      { devDependencies: { "@santi020k/auth-testing": "workspace:*" } },
      new Set(["@santi020k/auth-testing"]),
    );
    assert.equal(names.size, 0);
  });
});

void describe("topologicalOrder", () => {
  void it("orders every package after its internal dependencies", () => {
    const packages = [
      pkg("@santi020k/auth-cloudflare", "auth-cloudflare", { "@santi020k/auth-migrations": "workspace:*" }),
      pkg("@santi020k/auth-testing", "auth-testing", { "@santi020k/auth-migrations": "workspace:*" }),
      pkg("@santi020k/auth-migrations", "auth-migrations"),
      pkg("@santi020k/auth-client", "auth-client"),
    ];

    const order = topologicalOrder(packages);
    const position = new Map(order.map((entry, index) => [entry.manifest.name, index]));

    assert.equal(order.length, packages.length);
    assert.ok(position.get("@santi020k/auth-migrations") < position.get("@santi020k/auth-cloudflare"));
    assert.ok(position.get("@santi020k/auth-migrations") < position.get("@santi020k/auth-testing"));
  });

  void it("throws a descriptive error for a circular workspace dependency", () => {
    const packages = [
      pkg("@santi020k/a", "a", { "@santi020k/b": "workspace:*" }),
      pkg("@santi020k/b", "b", { "@santi020k/a": "workspace:*" }),
    ];

    assert.throws(() => topologicalOrder(packages), /Circular workspace dependency/u);
  });
});
