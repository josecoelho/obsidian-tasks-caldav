import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	// Project-specific rule overrides — must include plugin ref so ESLint can resolve rule names
	{
		plugins: { obsidianmd },
		rules: {
			"obsidianmd/ui/sentence-case": ["error", {
				mode: "strict",
			}],
			"@typescript-eslint/require-await": "error",
		},
	},
	// Test files: add jest globals and relax some rules
	{
		files: ["src/**/*.test.ts", "__mocks__/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.jest,
			},
		},
		rules: {},
	},
	globalIgnores([
		"node_modules/",
		"dist/",
		"main.js",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"jest.config.cjs",
		"scripts/",
		"test/",
		"coverage/",
		"coverage-e2e/",
		"coverage-unit/",
		".worktrees/",
		"obsidian-releases/",
		"docs/",
	]),
);
