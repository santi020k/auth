import { defineConfig } from "@santi020k/eslint-config-basic";

export default await defineConfig(
  {
    features: {
      "astro-doctor": true,
    },
    frameworks: {
      astro: true,
    },
  },
  {
    ignores: ["**/dist/**", "**/dist-test/**", "apps/playground/public/app.js"],
  },
  {
    settings: {
      n: {
        // Package `bin` fields point at built `dist/*.js` output; map TS
        // sources to their built path so `n/hashbang` (and other `n/` rules
        // that resolve `bin` entries) recognize a package-local CLI's source
        // file as the bin file it compiles into.
        convertPath: {
          "src/**/*.ts": ["^src/(.+)\\.ts$", "dist/$1.js"],
        },
      },
    },
  },
  {
    files: ["**/*.{astro,js,mjs,ts}"],
    rules: {
      "@stylistic/arrow-parens": ["warn", "always"],
      "@stylistic/comma-dangle": ["warn", "always-multiline"],
      "@stylistic/function-call-argument-newline": "off",
      "@stylistic/implicit-arrow-linebreak": "off",
      "@stylistic/max-len": "off",
      "@stylistic/member-delimiter-style": [
        "warn",
        {
          multiline: { delimiter: "semi", requireLast: true },
          singleline: { delimiter: "semi", requireLast: false },
        },
      ],
      "@stylistic/operator-linebreak": "off",
      "@stylistic/padding-line-between-statements": "off",
      "@stylistic/quotes": ["warn", "double", { avoidEscape: true }],
      "@stylistic/semi": ["warn", "always"],
      "func-style": "off",
    },
  },
);
