import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";

export default [
  {},
  {languageOptions: { globals: {...globals.browser, ...globals.node} }},
  pluginJs.configs.recommended,
  tseslint.config({
    files: ["src/**.ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    rules: {
      "@typescript-eslint/require-await": "off"
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    }
  }),
  pluginReact.configs.flat.recommended,
  {
    rules: {
      "react/display-name": "off",
      "react/prop-types": "off"
    }
  }
];