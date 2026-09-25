import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPasskeyAuthenticationUserVerified, isPasskeyRegistrationUserVerified } from "../src/passkey-verification.js";

void describe("passkey user verification", () => {
  void it("fails registration closed unless the verified ceremony reports user verification", () => {
    assert.equal(isPasskeyRegistrationUserVerified({ registrationInfo: { userVerified: true } }), true);
    assert.equal(isPasskeyRegistrationUserVerified({ registrationInfo: { userVerified: false } }), false);
    assert.equal(isPasskeyRegistrationUserVerified({}), false);
  });

  void it("fails authentication closed unless the verified ceremony reports user verification", () => {
    assert.equal(isPasskeyAuthenticationUserVerified({ authenticationInfo: { userVerified: true } }), true);
    assert.equal(isPasskeyAuthenticationUserVerified({ authenticationInfo: { userVerified: false } }), false);
    assert.equal(isPasskeyAuthenticationUserVerified({ authenticationInfo: {} }), false);
  });
});
