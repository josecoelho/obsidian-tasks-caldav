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
	// Project-specific rule overrides
	{
		rules: {
			"obsidianmd/ui/sentence-case": ["error", {
				brands: ["CalDAV", "Obsidian", "obsidian-tasks"],
				acronyms: ["ID", "URL"],
			}],
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
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"@typescript-eslint/no-unsafe-function-type": "off",
		},
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
