const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CODE_PATTERN = /^\d{6}$/u;

export type AuthEmailLocale = "en" | "es";

export interface LoginCodeEmailInput {
  appName: string;
  email: string;
  expiresInMinutes?: number;
  locale?: AuthEmailLocale;
  otp: string;
}

export interface RenderedEmail {
  html: string;
  subject: string;
  text: string;
  to: string;
}

export interface ResendAuthEmailOptions {
  apiKey: string;
  hooks?: AuthEmailDeliveryHooks;
  fetch?: typeof fetch;
  from: string;
  renderEmail?: AuthEmailRenderer;
}

export interface AuthEmailTemplateInput {
  appName: string;
  email: string;
  expiresInMinutes: number;
  locale: AuthEmailLocale;
  otp: string;
}

export type AuthEmailRenderer = (input: LoginCodeEmailInput) => RenderedEmail;

export interface AuthEmailDeliveryMetadata {
  locale: AuthEmailLocale;
  provider: "development-mailbox" | "resend";
  recipient: string;
}

export interface AuthEmailDeliveryReceipt extends AuthEmailDeliveryMetadata {
  messageId: string | null;
  providerRequestId: string | null;
}

export interface AuthEmailDeliveryFailure extends AuthEmailDeliveryMetadata {
  providerRequestId: string | null;
  status: number | null;
}

export interface AuthEmailDeliveryHooks {
  onAttempt?: (metadata: AuthEmailDeliveryMetadata) => Promise<void> | void;
  onDelivered?: (receipt: AuthEmailDeliveryReceipt) => Promise<void> | void;
  onFailed?: (failure: AuthEmailDeliveryFailure) => Promise<void> | void;
}

export interface AuthEmailTemplate {
  html(input: AuthEmailTemplateInput): string;
  subject(input: AuthEmailTemplateInput): string;
  text(input: AuthEmailTemplateInput): string;
}

export type AuthEmailTemplates = Partial<Record<AuthEmailLocale, AuthEmailTemplate>>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error("auth_email_recipient_invalid");
  return email;
}

function positiveExpiry(value: number | undefined): number {
  const expiry = value ?? 10;
  if (!Number.isSafeInteger(expiry) || expiry <= 0) throw new Error("auth_email_expiry_invalid");
  return expiry;
}

function resolveTemplateInput(input: LoginCodeEmailInput): AuthEmailTemplateInput {
  const appName = requiredText(input.appName, "auth_email_app_name_invalid");
  const email = normalizeEmail(input.email);
  if (!CODE_PATTERN.test(input.otp)) throw new Error("auth_email_code_invalid");
  return {
    appName,
    email,
    expiresInMinutes: positiveExpiry(input.expiresInMinutes),
    locale: input.locale ?? "en",
    otp: input.otp,
  };
}

const DEFAULT_TEMPLATES: Record<AuthEmailLocale, AuthEmailTemplate> = {
  en: {
    html: ({ appName, expiresInMinutes, otp }) =>
      `<p>Your ${escapeHtml(appName)} verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:.2em">${escapeHtml(otp)}</p><p>It expires in ${expiresInMinutes} minutes.</p>`,
    subject: ({ appName, otp }) => `${otp} is your ${appName} code`,
    text: ({ appName, expiresInMinutes, otp }) =>
      `Your ${appName} verification code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
  },
  es: {
    html: ({ appName, expiresInMinutes, otp }) =>
      `<p>Tu código de verificación para ${escapeHtml(appName)} es:</p><p style="font-size:28px;font-weight:700;letter-spacing:.2em">${escapeHtml(otp)}</p><p>Vence en ${expiresInMinutes} minutos.</p>`,
    subject: ({ appName, otp }) => `${otp} es tu código de ${appName}`,
    text: ({ appName, expiresInMinutes, otp }) =>
      `Tu código de verificación para ${appName} es ${otp}. Vence en ${expiresInMinutes} minutos.`,
  },
};

export function createLoginCodeEmailRenderer(templates: AuthEmailTemplates = {}): AuthEmailRenderer {
  return (input) => {
    const resolved = resolveTemplateInput(input);
    const template = templates[resolved.locale] ?? DEFAULT_TEMPLATES[resolved.locale];
    return {
      html: template.html(resolved),
      subject: template.subject(resolved),
      text: template.text(resolved),
      to: resolved.email,
    };
  };
}

export function renderLoginCodeEmail(input: LoginCodeEmailInput): RenderedEmail {
  return createLoginCodeEmailRenderer()(input);
}

export class AuthEmailDeliveryError extends Error {
  readonly providerRequestId: string | null;
  readonly status: number | null;

  constructor(status: number | null, providerRequestId: string | null = null) {
    super("auth_email_delivery_failed");
    this.name = "AuthEmailDeliveryError";
    this.providerRequestId = providerRequestId;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callHook<T>(callback: ((value: T) => Promise<void> | void) | undefined, value: T): Promise<void> {
  if (!callback) return;
  try {
    await callback(value);
  } catch {
    // Observability must not change authentication delivery behavior.
  }
}

async function deliverWithResend(
  request: typeof fetch,
  apiKey: string,
  from: string,
  email: RenderedEmail,
  metadata: AuthEmailDeliveryMetadata,
): Promise<AuthEmailDeliveryReceipt> {
  let response: Response;
  try {
    response = await request(RESEND_ENDPOINT, {
      body: JSON.stringify({
        from,
        html: email.html,
        subject: email.subject,
        text: email.text,
        to: [email.to],
      }),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    throw new AuthEmailDeliveryError(null);
  }
  const providerRequestId = response.headers.get("x-request-id");
  if (!response.ok) throw new AuthEmailDeliveryError(response.status, providerRequestId);
  const payload: unknown = await response.json().catch(() => null);
  const messageId = isRecord(payload) && typeof payload.id === "string" ? payload.id : null;
  return { ...metadata, messageId, providerRequestId };
}

export function createResendAuthEmailSender(options: ResendAuthEmailOptions) {
  const apiKey = requiredText(options.apiKey, "auth_email_api_key_invalid");
  const from = requiredText(options.from, "auth_email_from_invalid");
  const request = options.fetch ?? fetch;
  const renderer = options.renderEmail ?? renderLoginCodeEmail;

  return async (input: LoginCodeEmailInput): Promise<AuthEmailDeliveryReceipt> => {
    const email = renderer(input);
    const metadata: AuthEmailDeliveryMetadata = {
      locale: input.locale ?? "en",
      provider: "resend",
      recipient: normalizeEmail(email.to),
    };
    await callHook(options.hooks?.onAttempt, metadata);
    try {
      const receipt = await deliverWithResend(request, apiKey, from, email, metadata);
      await callHook(options.hooks?.onDelivered, receipt);
      return receipt;
    } catch (error) {
      const deliveryError = error instanceof AuthEmailDeliveryError ? error : new AuthEmailDeliveryError(null);
      await callHook(options.hooks?.onFailed, {
        ...metadata,
        providerRequestId: deliveryError.providerRequestId,
        status: deliveryError.status,
      });
      throw deliveryError;
    }
  };
}

export interface DevelopmentAuthEmail extends RenderedEmail {
  createdAt: string;
}

export interface DevelopmentAuthEmailMailbox {
  clear(): void;
  readonly messages: readonly DevelopmentAuthEmail[];
  send(input: LoginCodeEmailInput): Promise<AuthEmailDeliveryReceipt>;
}

export interface DevelopmentAuthEmailMailboxOptions {
  enabled: boolean;
  hooks?: AuthEmailDeliveryHooks;
  origin: string;
  renderEmail?: AuthEmailRenderer;
}

function assertLocalDevelopmentOrigin(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("auth_email_dev_mailbox_origin_invalid");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    !local ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("auth_email_dev_mailbox_origin_invalid");
  }
}

/** In-memory mailbox that can reveal login codes only after an explicit localhost-only opt-in. */
export function createDevelopmentAuthEmailMailbox(
  options: DevelopmentAuthEmailMailboxOptions,
): DevelopmentAuthEmailMailbox {
  if (!options.enabled) throw new Error("auth_email_dev_mailbox_disabled");
  assertLocalDevelopmentOrigin(options.origin);
  const renderer = options.renderEmail ?? renderLoginCodeEmail;
  const stored: DevelopmentAuthEmail[] = [];
  return {
    clear: () => {
      stored.length = 0;
    },
    get messages() {
      return stored.map((message) => ({ ...message }));
    },
    async send(input) {
      const email = renderer(input);
      const metadata: AuthEmailDeliveryMetadata = {
        locale: input.locale ?? "en",
        provider: "development-mailbox",
        recipient: normalizeEmail(email.to),
      };
      await callHook(options.hooks?.onAttempt, metadata);
      stored.push({ ...email, createdAt: new Date().toISOString() });
      const receipt = { ...metadata, messageId: null, providerRequestId: null };
      await callHook(options.hooks?.onDelivered, receipt);
      return receipt;
    },
  };
}
