import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["main.js", "node_modules/", "test-vault/", "esbuild.config.mjs", "version-bump.mjs"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.mjs"] },
			},
		},
	},
	{
		// Unit tests run in Node, not in Obsidian.
		files: ["test/**/*.ts"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
			// Tests run outside Obsidian, so they use the npm moment it bundles.
			"@typescript-eslint/no-restricted-imports": "off",
			"import/no-extraneous-dependencies": "off",
		},
	},
]);
