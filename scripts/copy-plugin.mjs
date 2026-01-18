import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(repoRoot, "manifest.json");
const vaultPluginsDir =
	process.env.OBSIDIAN_PLUGIN_DIR ??
	"/Users/wband/Library/Mobile Documents/iCloud~md~obsidian/Documents/Main/.obsidian/plugins";

async function getPluginId() {
	try {
		const raw = await fs.readFile(manifestPath, "utf-8");
		const manifest = JSON.parse(raw);
		return typeof manifest.id === "string" ? manifest.id : "tuon-research-obsidian";
	} catch {
		return "tuon-research-obsidian";
	}
}

const pluginId = await getPluginId();
const defaultTarget = join(vaultPluginsDir, pluginId);
const targetDir = process.argv[2] ?? defaultTarget;

const requiredFiles = ["main.js", "manifest.json", "sql-wasm.wasm"];
const optionalFiles = ["styles.css"];

async function fileExists(path) {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}

async function copyFiles(files, isRequired) {
	for (const file of files) {
		const source = join(repoRoot, file);
		const dest = join(targetDir, file);
		const exists = await fileExists(source);
		if (!exists) {
			if (isRequired) {
				throw new Error(
					`Missing required file: ${file}. Run the build before copying.`
				);
			}
			continue;
		}
		await fs.copyFile(source, dest);
		console.log(`Copied ${file} → ${dest}`);
	}
}

await fs.mkdir(targetDir, { recursive: true });
await copyFiles(requiredFiles, true);
await copyFiles(optionalFiles, false);
