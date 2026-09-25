import type { AuthSessionIdentity, OwnerAuthOptions, resolveOwnerAuthPolicy } from "../src/index.js";

declare const database: D1Database;

export const legacyPolicyOptions: Parameters<typeof resolveOwnerAuthPolicy>[0] = {
  appName: "v0.3 compatibility fixture",
  applicationOrigin: "https://app.example.com",
  authServerURL: "https://api.app.example.com",
  cookiePrefix: "v03-owner",
  emailOtpRateLimit: { max: 4, window: 300 },
  legacySecret: "l".repeat(32),
  ownerEmail: "owner@example.com",
  secrets: [
    { value: "c".repeat(32), version: 2 },
    { value: "p".repeat(32), version: 1 },
  ],
};

export const legacyIdentity: AuthSessionIdentity = {
  email: "owner@example.com",
  userId: "owner-id",
};

export const legacyRuntimeOptions: OwnerAuthOptions = {
  appName: "v0.3 compatibility fixture",
  applicationOrigin: "https://app.example.com",
  authServerURL: "https://api.app.example.com",
  cookiePrefix: "v03-owner",
  database,
  ownerEmail: "owner@example.com",
  secret: "s".repeat(32),
  sendVerificationOTP: () => Promise.resolve(),
  waitUntil: () => undefined,
};
