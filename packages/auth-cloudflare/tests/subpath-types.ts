import { createApplicationAuthClient, createOwnerAuthClient } from "../src/client.js";
import {
  type AuthEnv,
  type AuthResolver,
  type AuthVariables,
  createAuthMiddleware,
  createOwnerAuthMiddleware,
  type OwnerAuthEnv,
  type OwnerAuthResolver,
  type OwnerAuthVariables,
} from "../src/hono.js";
import type { MultiUserAuthInstance, OwnerAuthInstance } from "../src/index.js";
import type { AuthSchemaFinding, OwnerAuthSchemaFinding } from "../src/schema.js";

export function verifyClientSurface(): void {
  const client = createOwnerAuthClient({ authServerURL: "https://api.example.com" });
  const applicationClient = createApplicationAuthClient({ authServerURL: "https://api.example.com" });
  void client.emailOtp.sendVerificationOtp({ email: "owner@example.com", type: "sign-in" });
  void client.signIn.emailOtp({ email: "owner@example.com", otp: "123456" });
  void client.signIn.passkey();
  void client.passkey.addPasskey({ name: "Laptop" });
  void applicationClient.getSession();
}

export function verifyMultiUserMiddlewareSurface(auth: MultiUserAuthInstance): AuthEnv {
  void createAuthMiddleware(auth);
  return {
    Variables: {
      authSession: {
        authenticatedAt: "2026-09-25T12:00:00.000Z",
        email: "member@example.com",
        expiresAt: "2026-10-25T12:00:00.000Z",
        sessionId: "member-session-id",
        userId: "member-user-id",
      },
    },
  };
}

export function verifyMiddlewareSurface(auth: OwnerAuthInstance): OwnerAuthEnv {
  void createOwnerAuthMiddleware(auth);
  return {
    Variables: {
      ownerAuthSession: {
        authenticatedAt: "2026-09-25T12:00:00.000Z",
        email: "owner@example.com",
        expiresAt: "2026-10-25T12:00:00.000Z",
        sessionId: "owner-session-id",
        userId: "owner-user-id",
      },
    },
  };
}

export function verifyPublicTypes(
  authVariables: AuthVariables,
  authFinding: AuthSchemaFinding,
  authResolver: AuthResolver<AuthEnv>,
  variables: OwnerAuthVariables,
  finding: OwnerAuthSchemaFinding,
  resolver: OwnerAuthResolver<OwnerAuthEnv>,
): [
  AuthVariables,
  AuthSchemaFinding,
  AuthResolver<AuthEnv>,
  OwnerAuthVariables,
  OwnerAuthSchemaFinding,
  OwnerAuthResolver<OwnerAuthEnv>,
] {
  return [authVariables, authFinding, authResolver, variables, finding, resolver];
}
