import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const production = process.argv[2] === "production";
// If a local test vault sits next to the source, each build is copied into it
// so it can be opened in Obsidian. The vault isn't part of the repository.
const testPluginDir = "test-vault/.obsidian/plugins/better-backlinks";

const copyToTestVault = {
	name: "copy-to-test-vault",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length || !existsSync("test-vault")) return;
			mkdirSync(testPluginDir, { recursive: true });
			for (const file of ["main.js", "manifest.json", "styles.css"]) {
				copyFileSync(file, `${testPluginDir}/${file}`);
			}
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
		...builtinModules,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	minify: production,
	outfile: "main.js",
	plugins: [copyToTestVault],
});

if (production) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
