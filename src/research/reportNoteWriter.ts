import { App, TFile } from "obsidian";

export type ReportNoteData = {
	title: string;
	summary?: string | null;
	markdown: string;
	originalPrompt?: string | null;
	optimizedPrompt?: string | null;
	includePromptSection: boolean;
	folder: string;
};

export class ReportNoteWriter {
	constructor(private app: App) {}

	async writeReport(data: ReportNoteData): Promise<TFile> {
		const folderPath = data.folder.trim() || "Deep Research";
		await this.ensureFolder(folderPath);
		const fileName = this.createFileName(data.title || "Research report");
		const path = await this.findAvailablePath(`${folderPath}/${fileName}.md`);
		const content = this.buildContent(data);
		return this.app.vault.create(path, content);
	}

	private buildContent(data: ReportNoteData): string {
		const lines: string[] = [];
		lines.push(`# ${data.title || "Research report"}`.trim());
		lines.push("");
		if (data.summary?.trim()) {
			lines.push("## Summary");
			lines.push("");
			lines.push(data.summary.trim());
			lines.push("");
		}
		lines.push("## Report");
		lines.push("");
		lines.push(data.markdown.trim());
		lines.push("");

		if (data.includePromptSection) {
			lines.push("## Prompt");
			lines.push("");
			lines.push("<details>");
			lines.push("<summary>Show prompts</summary>");
			lines.push("");
			lines.push("### Original prompt");
			lines.push("");
			lines.push((data.originalPrompt || "").trim() || "_(empty)_");
			lines.push("");
			lines.push("### Optimized prompt");
			lines.push("");
			lines.push((data.optimizedPrompt || "").trim() || "_(empty)_");
			lines.push("");
			lines.push("</details>");
			lines.push("");
		}

		return lines.join("\n");
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const exists = await this.app.vault.adapter.exists(folderPath);
		if (!exists) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	private createFileName(title: string): string {
		const cleaned = title.replace(/[\\/:*?"<>|]/g, "").trim();
		const base = cleaned || "Research report";
		const date = new Date().toISOString().slice(0, 10);
		return `${base} - ${date}`;
	}

	private async findAvailablePath(basePath: string): Promise<string> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(basePath))) return basePath;
		const base = basePath.replace(/\.md$/, "");
		for (let i = 1; i < 1000; i += 1) {
			const candidate = `${base} (${i}).md`;
			if (!(await adapter.exists(candidate))) return candidate;
		}
		return `${base}-${Date.now()}.md`;
	}
}
