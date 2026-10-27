import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";
import globals from "globals";

export default defineConfig([
  globalIgnores([
    ".next/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": hooks, "@next/next": next },
    rules: {
      ...hooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["tests/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
