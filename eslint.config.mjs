import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

const projectRules = {
    "no-unused-vars": "off",
    "no-undef": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    "@typescript-eslint/no-explicit-any": "off",
    "prefer-const": "warn",
    "@typescript-eslint/ban-ts-comment": "off",
    "no-prototype-builtins": "off",
    "@typescript-eslint/no-empty-function": "off"
};

const svelteRecommended = svelte.configs["flat/recommended"].map((config) =>
    config.rules && !config.files ? { ...config, files: ["**/*.svelte"] } : config
);

export default defineConfig([
    {
        ignores: [
            "node_modules/**",
            "npm/**",
            "build0/**",
            "main.js",
            "scripts/**",
            "version-bump.mjs",
            "vite.config.ts",
            "vite.config.mjs"
        ]
    },
    ...obsidianmd.configs.recommended,
    ...svelteRecommended,
    {
        files: ["**/*.ts"],
        plugins: {
            "@typescript-eslint": tseslint.plugin
        },
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: projectRules
    },
    {
        files: ["**/*.svelte"],
        plugins: {
            "@typescript-eslint": tseslint.plugin
        },
        languageOptions: {
            parserOptions: {
                parser: tsparser,
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: [".svelte"]
            }
        },
        rules: projectRules
    }
]);
