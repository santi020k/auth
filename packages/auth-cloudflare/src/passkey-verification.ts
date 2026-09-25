interface RegistrationVerificationResult {
  registrationInfo?: { userVerified?: boolean } | null;
}

interface AuthenticationVerificationResult {
  authenticationInfo: { userVerified?: boolean };
}

/** @internal Enforces the server-observed WebAuthn UV flag after registration verification. */
export function isPasskeyRegistrationUserVerified(verification: RegistrationVerificationResult): boolean {
  return verification.registrationInfo?.userVerified === true;
}

/** @internal Enforces the server-observed WebAuthn UV flag after authentication verification. */
export function isPasskeyAuthenticationUserVerified(verification: AuthenticationVerificationResult): boolean {
  return verification.authenticationInfo.userVerified === true;
}
