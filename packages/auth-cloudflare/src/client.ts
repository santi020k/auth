import { passkeyClient } from "@better-auth/passkey/client";
import type { AuthClient } from "better-auth/client";
import { createAuthClient as createBetterAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

const DEFAULT_BASE_PATH = "/api/auth";

export interface AuthClientOptions {
  /** Origin of the Worker that mounts the auth handler. */
  authServerURL: string;
  /** Path where the auth handler is mounted. */
  basePath?: `/${string}`;
}

interface OwnerAuthClientConfiguration {
  basePath: string;
  baseURL: string;
  fetchOptions: { credentials: "include" };
  plugins: [ReturnType<typeof emailOTPClient>, ReturnType<typeof passkeyClient>];
}

export type ApplicationAuthClient = AuthClient<OwnerAuthClientConfiguration>;
export type OwnerAuthClientOptions = AuthClientOptions;
export type OwnerAuthClient = ApplicationAuthClient;

function normalizeAuthServerURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("owner_auth_server_url_invalid");
  }

  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const allowedProtocol = url.protocol === "https:" || (localHost && url.protocol === "http:");
  if (!allowedProtocol || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("owner_auth_server_url_invalid");
  }

  return url.origin;
}

function normalizeBasePath(value: `/${string}` | undefined): string {
  const basePath = value ?? DEFAULT_BASE_PATH;
  if (!/^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/u.test(basePath) || basePath.includes("//")) {
    throw new Error("owner_auth_base_path_invalid");
  }
  return basePath;
}

/**
 * Creates the browser client for the email OTP and passkey policy.
 * Credentials are always included so a UI and its auth Worker may use separate origins.
 */
export function createApplicationAuthClient(options: AuthClientOptions): ApplicationAuthClient {
  return createBetterAuthClient<OwnerAuthClientConfiguration>({
    basePath: normalizeBasePath(options.basePath),
    baseURL: normalizeAuthServerURL(options.authServerURL),
    fetchOptions: { credentials: "include" },
    plugins: [emailOTPClient(), passkeyClient()],
  });
}

/** Backward-compatible single-owner browser client name. */
export function createOwnerAuthClient(options: OwnerAuthClientOptions): OwnerAuthClient {
  return createApplicationAuthClient(options);
}
