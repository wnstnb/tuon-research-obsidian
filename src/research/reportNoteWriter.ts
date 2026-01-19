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
		if (data.summary?.trim()) {
			lines.push("## Summary");
			lines.push("");
			lines.push(data.summary.trim());
			lines.push("");
		}
		lines.push("## Report");
		lines.push("");
		lines.push(this.stripDuplicateTitle(data.markdown, data.title));
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

	private stripDuplicateTitle(markdown: string, title: string): string {
		const cleaned = (markdown || "").trim();
		if (!cleaned) return "";
		const lines = cleaned.split(/\r?\n/);
		let firstIndex = 0;
		while (firstIndex < lines.length && !(lines[firstIndex] ?? "").trim()) {
			firstIndex += 1;
		}
		if (firstIndex >= lines.length) return cleaned;
		const firstLine = (lines[firstIndex] ?? "").trim();
		if (firstLine.startsWith("#")) {
			const heading = firstLine.replace(/^#+\s*/, "").trim();
			const normalizedHeading = this.normalizeHeading(heading);
			const normalizedHeadingNoDate = this.normalizeHeading(this.stripDateSuffix(heading));
			const normalizedTitle = this.normalizeHeading(title);
			const normalizedTitleNoDate = this.normalizeHeading(this.stripDateSuffix(title));
			if (
				this.isHeadingMatch(
					normalizedHeading,
					normalizedHeadingNoDate,
					normalizedTitle,
					normalizedTitleNoDate
				)
			) {
				lines.splice(firstIndex, 1);
				if (firstIndex < lines.length && !(lines[firstIndex] ?? "").trim()) {
					lines.splice(firstIndex, 1);
				}
			}
		}
		return lines.join("\n").trim();
	}

	private isHeadingMatch(
		heading: string,
		headingNoDate: string,
		title: string,
		titleNoDate: string
	): boolean {
		const targets = [title, titleNoDate].filter((value) => value && value.trim().length > 0);
		const headings = [heading, headingNoDate].filter((value) => value && value.trim().length > 0);
		if (!targets.length || !headings.length) return false;
		const minLength = 8;
		for (const h of headings) {
			for (const t of targets) {
				if (h === t) return true;
				if (h.length >= minLength && t.startsWith(h)) return true;
				if (t.length >= minLength && h.startsWith(t)) return true;
			}
		}
		return false;
	}

	private stripDateSuffix(value: string): string {
		const trimmed = (value || "").trim();
		if (!trimmed) return "";
		const isoDatePattern = /\s*[-–—]\s*\d{4}-\d{2}-\d{2}\s*$/;
		const isoParenPattern = /\s*\(\d{4}-\d{2}-\d{2}\)\s*$/;
		const longDatePattern = /\s*[-–—]\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}\s*$/;
		return trimmed
			.replace(isoParenPattern, "")
			.replace(isoDatePattern, "")
			.replace(longDatePattern, "")
			.trim();
	}

	private normalizeHeading(value: string): string {
		return (value || "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
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
