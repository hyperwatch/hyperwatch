import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import nodePlugin from "eslint-plugin-n";
import globals from "globals";

export default [
  {
    ignores: ["eslint.config.mjs"],
  },
  js.configs.recommended,
  nodePlugin.configs["flat/recommended"],
  importPlugin.flatConfigs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2018,
      globals: {
        ...globals.node,
        ...globals.es2017,
      },
    },
    rules: {
      // -------------------
      // Relaxing some rules
      // -------------------

      "no-console": "off",
      "n/no-process-exit": "off",

      // ----------------------------------
      // Adding more eslint rules as errors
      // ----------------------------------

      // Disallow Unused Variables
      // https://eslint.org/docs/rules/no-unused-vars
      "no-unused-vars": ["error", { vars: "all", caughtErrors: "none" }],
      // require using arrow functions as callbacks
      // https://eslint.org/docs/rules/prefer-arrow-callback
      "prefer-arrow-callback": "error",
      // require using template literals instead of string concatenation
      // http://eslint.org/docs/rules/prefer-template
      "prefer-template": "error",
      // require using of const declaration for variables that are never modified after declared
      // https://eslint.org/docs/rules/prefer-const
      "prefer-const": "error",
      // disallow modifying variables that are declared using const
      // https://eslint.org/docs/rules/no-const-assign
      "no-const-assign": "error",
      // require let or const instead of var
      // https://eslint.org/docs/rules/no-var
      "no-var": "error",

      // ------------------------------------
      // Adding more eslint rules as warnings
      // ------------------------------------

      // require at least one whitespace after comments( // and /*)
      // https://eslint.org/docs/rules/spaced-comment
      "spaced-comment": ["warn", "always"],
      // Require Following Curly Brace Conventions
      // https://eslint.org/docs/rules/curly
      curly: ["warn", "all"],
      // Require empty lines after class members
      // https://eslint.org/docs/rules/lines-between-class-members
      "lines-between-class-members": [
        "warn",
        "always",
        { exceptAfterSingleLine: true },
      ],

      "import/order": [
        "warn",
        {
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
          "newlines-between": "always",
        },
      ],
    },
  },
  // Test files: add mocha globals
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
  },
  // Browser script: add browser globals and disable node rules
  {
    files: ["src/script.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "n/no-unsupported-features/es-syntax": "off",
      "n/no-unsupported-features/node-builtins": "off",
      "n/no-missing-require": "off",
      "n/no-missing-import": "off",
    },
  },
  // Scripts: allow experimental Node.js features (e.g. fetch)
  {
    files: ["scripts/**/*.js"],
    rules: {
      "n/no-unsupported-features/node-builtins": [
        "error",
        { allowExperimental: true },
      ],
    },
  },
];
