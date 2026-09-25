import { createOwnerAuthClient } from "../src/client.js";
import {
  createOwnerAuthMiddleware,
  type OwnerAuthEnv,
  type OwnerAuthResolver,
  type OwnerAuthVariables,
} from "../src/hono.js";
import type { OwnerAuthInstance } from "../src/index.js";
import type { OwnerAuthSchemaFinding } from "../src/schema.js";

export function verifyClientSurface(): void {
  const client = createOwnerAuthClient({ authServerURL: "https://api.example.com" });
  void client.emailOtp.sendVerificationOtp({ email: "owner@example.com", type: "sign-in" });
  void client.signIn.emailOtp({ email: "owner@example.com", otp: "123456" });
  void client.signIn.passkey();
  void client.passkey.addPasskey({ name: "Laptop" });
}

export function verifyMiddlewareSurface(auth: OwnerAuthInstance): OwnerAuthEnv {
  void createOwnerAuthMiddleware(auth);
  return {
    Variables: {
      ownerAuthSession: { email: "owner@example.com", userId: "owner-user-id" },
    },
  };
}

export function verifyPublicTypes(
  variables: OwnerAuthVariables,
  finding: OwnerAuthSchemaFinding,
  resolver: OwnerAuthResolver<OwnerAuthEnv>,
): [OwnerAuthVariables, OwnerAuthSchemaFinding, OwnerAuthResolver<OwnerAuthEnv>] {
  return [variables, finding, resolver];
}
