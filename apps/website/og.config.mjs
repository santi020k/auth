import { definePresetConfig } from "@santi020k/og/presets";

import { authSite, homePage } from "./src/lib/seo.ts";

export default definePresetConfig({
  cache: {
    sources: ["src/assets/logo-mark.svg", "src/lib/seo.ts"],
  },
  cards: [
    authSite.card(homePage, {
      data: ({ title }) => ({
        badge: "Private preview",
        description: "Single-owner or multi-user email codes and passkeys for Cloudflare Workers and D1.",
        eyebrow: "Cloudflare Workers · D1 · Passkeys",
        title,
        variant: "product",
      }),
    }),
  ],
  clean: true,
  outputDirectory: "public/og",
  preset: {
    brand: {
      domain: "auth.santi020k.com",
      logo: "src/assets/logo-mark.svg",
      name: "santi020k auth",
    },
    decoration: (_data, _context, { accent, theme }) => `
      <g transform="translate(790 164)">
        <rect width="326" height="340" rx="44" fill="${accent}" opacity="0.12"/>

        <g fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="7 8" opacity="0.62">
          <path d="M126 126 94 100"/>
          <path d="m200 126 32-26"/>
          <path d="m126 214-32 26"/>
          <path d="m200 214 32 26"/>
        </g>

        <g font-family="Inter" font-size="10" font-weight="700" letter-spacing="1.2">
          <g transform="translate(18 24)">
            <rect width="120" height="86" rx="18" fill="${theme.panel}" stroke="${accent}" stroke-opacity="0.3"/>
            <circle cx="24" cy="25" r="9" fill="${accent}" opacity="0.82"/>
            <path d="M12 49h96M12 61h70" stroke="${accent}" stroke-width="5" stroke-linecap="round" opacity="0.34"/>
            <text x="44" y="29" fill="${theme.foreground}">APP 01</text>
            <text x="12" y="77" fill="${theme.muted}" font-size="8">OWN IDENTITY</text>
          </g>
          <g transform="translate(188 24)">
            <rect width="120" height="86" rx="18" fill="${theme.panel}" stroke="${accent}" stroke-opacity="0.3"/>
            <circle cx="24" cy="25" r="9" fill="${accent}" opacity="0.82"/>
            <path d="M12 49h96M12 61h70" stroke="${accent}" stroke-width="5" stroke-linecap="round" opacity="0.34"/>
            <text x="44" y="29" fill="${theme.foreground}">APP 02</text>
            <text x="12" y="77" fill="${theme.muted}" font-size="8">OWN IDENTITY</text>
          </g>
          <g transform="translate(18 230)">
            <rect width="120" height="86" rx="18" fill="${theme.panel}" stroke="${accent}" stroke-opacity="0.3"/>
            <ellipse cx="24" cy="22" rx="11" ry="5" fill="${accent}" opacity="0.82"/>
            <path d="M13 22v18c0 3 5 5 11 5s11-2 11-5V22" fill="none" stroke="${accent}" stroke-width="3" opacity="0.82"/>
            <text x="44" y="29" fill="${theme.foreground}">D1 01</text>
            <text x="12" y="77" fill="${theme.muted}" font-size="8">SEPARATE STATE</text>
          </g>
          <g transform="translate(188 230)">
            <rect width="120" height="86" rx="18" fill="${theme.panel}" stroke="${accent}" stroke-opacity="0.3"/>
            <ellipse cx="24" cy="22" rx="11" ry="5" fill="${accent}" opacity="0.82"/>
            <path d="M13 22v18c0 3 5 5 11 5s11-2 11-5V22" fill="none" stroke="${accent}" stroke-width="3" opacity="0.82"/>
            <text x="44" y="29" fill="${theme.foreground}">D1 02</text>
            <text x="12" y="77" fill="${theme.muted}" font-size="8">SEPARATE STATE</text>
          </g>
        </g>

        <circle cx="163" cy="170" r="62" fill="${theme.panel}" stroke="${accent}" stroke-width="4"/>
        <circle cx="163" cy="170" r="51" fill="${accent}"/>
        <path d="M145 165v-12c0-11 7-19 18-19s18 8 18 19v12" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>
        <rect x="137" y="162" width="52" height="43" rx="11" fill="white"/>
        <circle cx="163" cy="181" r="6" fill="${accent}"/>
        <path d="M163 185v9" stroke="${accent}" stroke-width="5" stroke-linecap="round"/>
      </g>`,
    theme: {
      accent: "#2f7658",
      background: "#eef1e8",
      foreground: "#13231b",
      muted: "#66766d",
      panel: "#fbfcf8",
    },
    variant: "product",
  },
  routeManifest: {
    publicPath: "/og",
  },
});
