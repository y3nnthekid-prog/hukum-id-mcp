import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const files = ["src/**/*.ts", "test/**/*.ts", "web/**/*.ts", "web/**/*.tsx"];

export default [
  { ignores: ["dist/**", "node_modules/**", "web/.next/**", "web/out/**"] },
  { ...js.configs.recommended, files },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files })),
  {
    files,
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
