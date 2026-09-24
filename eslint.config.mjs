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
