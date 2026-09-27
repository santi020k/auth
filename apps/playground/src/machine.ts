import { type CreatedMachineCredential, createMachineCredential } from "@santi020k/auth-machine";

const LOCAL_CREDENTIAL_LIFETIME_MS = 60 * 60 * 1000;

/** Creates a concurrency-safe local credential cache that refreshes at expiry. */
export function createLocalMachineCredentialProvider(
  now: () => number = Date.now,
): () => Promise<CreatedMachineCredential> {
  let credential: CreatedMachineCredential | undefined;
  let pending: Promise<CreatedMachineCredential> | undefined;

  return async () => {
    const timestamp = now();
    if (credential && Date.parse(credential.record.expiresAt) > timestamp) return credential;
    pending ??= createMachineCredential({
      credentialId: "local-playground",
      expiresAt: new Date(timestamp + LOCAL_CREDENTIAL_LIFETIME_MS).toISOString(),
      name: "Local playground client",
      now: timestamp,
      scopes: ["playground:read"],
      subject: "machine:local-playground",
    });
    try {
      credential = await pending;
      return credential;
    } finally {
      pending = undefined;
    }
  };
}
