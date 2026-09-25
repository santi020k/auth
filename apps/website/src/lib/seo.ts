import { composeJsonLd, defineSchema, webPageSchema, webSiteSchema } from "@santi020k/og/schema";
import { defineSite } from "@santi020k/og/site";

export const siteDescription =
  "Email-code and passkey authentication policy for isolated Hono applications running on Cloudflare Workers and D1.";
const multiUserDescription =
  "Authenticate multiple consumer-approved accounts without sharing identities, roles, sessions, or databases between applications.";

export const authSite = defineSite({
  defaults: {
    authors: ["Santiago Molina"],
    keywords: ["authentication", "Cloudflare Workers", "D1", "email code", "passkeys", "WebAuthn"],
    locale: "en_US",
    robots: {
      follow: true,
      index: true,
      maxImagePreview: "large",
      maxSnippet: -1,
      maxVideoPreview: -1,
    },
    twitter: { card: "summary_large_image" },
    type: "website",
  },
  locale: "en_US",
  publicImagePath: "/og",
  siteName: "santi020k auth",
  siteUrl: "https://auth.santi020k.com",
  titleTemplate: "%s · santi020k auth",
});

export const homePage = authSite.page({
  description: siteDescription,
  image: {
    alt: "santi020k auth — reusable authentication policy with isolated identity state",
    height: 630,
    output: "home.webp",
    width: 1200,
  },
  pathname: "/",
  schemaTypes: ["WebSite", "SoftwareSourceCode"],
  title: "Reusable authentication policy",
});

export const notFoundPage = authSite.page({
  description: "The requested auth documentation page could not be found.",
  pathname: "/404.html",
  robots: { follow: false, index: false },
  title: "Page not found",
});

export const multiUserPage = authSite.page({
  description: multiUserDescription,
  image: {
    alt: "santi020k auth — reusable authentication policy with isolated identity state",
    height: 630,
    output: "home.webp",
    width: 1200,
  },
  pathname: "/multi-user",
  schemaTypes: ["WebPage"],
  title: "Multi-user authentication",
});

const author = defineSchema({
  "@id": "https://santi020k.com/#person",
  "@type": "Person",
  name: "Santiago Molina",
  url: "https://santi020k.com",
});

export const multiUserStructuredData = composeJsonLd(
  webPageSchema({
    description: multiUserDescription,
    id: "https://auth.santi020k.com/multi-user#webpage",
    inLanguage: "en",
    isPartOf: defineSchema({
      "@id": "https://auth.santi020k.com/#website",
      "@type": "WebSite",
      name: "santi020k auth",
      url: "https://auth.santi020k.com",
    }),
    name: "Multi-user authentication",
    url: "https://auth.santi020k.com/multi-user",
  }),
  author,
);

export const homeStructuredData = composeJsonLd(
  webSiteSchema({
    description: siteDescription,
    id: "https://auth.santi020k.com/#website",
    inLanguage: "en",
    name: "santi020k auth",
    publisher: author,
    url: "https://auth.santi020k.com",
  }),
  defineSchema({
    "@id": "https://auth.santi020k.com/#software",
    "@type": "SoftwareSourceCode",
    author,
    codeRepository: "https://github.com/santi020k/auth",
    description: siteDescription,
    image: "https://auth.santi020k.com/og/home.webp",
    license: "https://github.com/santi020k/auth/blob/main/LICENSE",
    name: "@santi020k/auth-cloudflare",
    programmingLanguage: "TypeScript",
    runtimePlatform: "Cloudflare Workers",
    sameAs: ["https://github.com/santi020k/auth", "https://www.npmjs.com/package/@santi020k/auth-cloudflare"],
    url: "https://auth.santi020k.com",
  }),
);
