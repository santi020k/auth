import { createSantiAuthClient } from "@santi020k/auth-client";

const authClient = createSantiAuthClient({
  baseURL: window.location.origin,
});

const emailInput = document.querySelector<HTMLInputElement>("#email");
const otpInput = document.querySelector<HTMLInputElement>("#otp");
const statusOutput = document.querySelector<HTMLOutputElement>("#status");
const sessionOutput = document.querySelector<HTMLElement>("#session");

function requiredElement<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`missing_${name}`);
  return element;
}

const email = requiredElement(emailInput, "email");
const otp = requiredElement(otpInput, "otp");
const status = requiredElement(statusOutput, "status");
const session = requiredElement(sessionOutput, "session");

function message(value: string, isError = false): void {
  status.textContent = value;
  status.dataset.kind = isError ? "error" : "success";
}

async function refreshSession(): Promise<void> {
  const response = await fetch("/api/session", { headers: { Accept: "application/json" } });
  const identity: unknown = await response.json();
  session.textContent = identity === null ? "Signed out" : JSON.stringify(identity, null, 2);
}

async function run(action: () => Promise<void>): Promise<void> {
  status.textContent = "Working…";
  status.dataset.kind = "pending";
  try {
    await action();
    await refreshSession();
  } catch (error: unknown) {
    message(error instanceof Error ? error.message : "Something went wrong.", true);
  }
}

requiredElement(document.querySelector<HTMLButtonElement>("#send-code"), "send-code").addEventListener("click", () => {
  void run(async () => {
    const result = await authClient.emailOtp.sendVerificationOtp({ email: email.value, type: "sign-in" });
    if (result.error) throw new Error(result.error.message ?? "Could not send the code.");
    const response = await fetch("/api/dev/latest-code", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("The local code inbox is unavailable.");
    const latest: unknown = await response.json();
    if (typeof latest !== "object" || latest === null || !("otp" in latest) || typeof latest.otp !== "string") {
      throw new Error("No local code was captured.");
    }
    otp.value = latest.otp;
    message("Code generated locally and filled in.");
  });
});

requiredElement(document.querySelector<HTMLButtonElement>("#verify-code"), "verify-code").addEventListener(
  "click",
  () => {
    void run(async () => {
      const result = await authClient.signIn.emailOtp({ email: email.value, otp: otp.value });
      if (result.error) throw new Error(result.error.message ?? "The code could not be verified.");
      message("Signed in with the email code.");
    });
  },
);

requiredElement(document.querySelector<HTMLButtonElement>("#add-passkey"), "add-passkey").addEventListener(
  "click",
  () => {
    void run(async () => {
      const result = await authClient.passkey.addPasskey({ name: "Local platform passkey" });
      if (result.error) throw new Error(result.error.message ?? "The passkey could not be created.");
      message("Passkey added.");
    });
  },
);

requiredElement(document.querySelector<HTMLButtonElement>("#use-passkey"), "use-passkey").addEventListener(
  "click",
  () => {
    void run(async () => {
      const result = await authClient.signIn.passkey({ autoFill: false });
      if (result.error) throw new Error(result.error.message ?? "Passkey sign-in failed.");
      message("Signed in with a passkey.");
    });
  },
);

requiredElement(document.querySelector<HTMLButtonElement>("#sign-out"), "sign-out").addEventListener("click", () => {
  void run(async () => {
    const result = await authClient.signOut();
    if (result.error) throw new Error(result.error.message ?? "Sign out failed.");
    message("Signed out.");
  });
});

void refreshSession();
