import { App, TFile, TFolder } from "obsidian";
import { TaggedDocument } from "../ai/promptOptimizerPrompts";

export type TaggedFileReference = {
	id: string;
	title: string;
	path: string;
	type: "file" | "folder";
};

export type ResolvedTaggedDocumentsResult = {
	documents: TaggedDocument[];
	missing: string[];
	truncated: string[];
};

const DEFAULT_MAX_DOC_CHARS = 8000;
const DEFAULT_MAX_TOTAL_CHARS = 32000;

export async function resolveTaggedDocuments(
	app: App,
	refs: TaggedFileReference[],
	options?: { maxDocChars?: number; maxTotalChars?: number }
): Promise<ResolvedTaggedDocumentsResult> {
	const maxDocChars = options?.maxDocChars ?? DEFAULT_MAX_DOC_CHARS;
	const maxTotalChars = options?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;

	const documents: TaggedDocument[] = [];
	const missing: string[] = [];
	const truncated: string[] = [];
	let remaining = maxTotalChars;
	const expandedRefs = expandTaggedReferences(app, refs, missing);

	for (const ref of expandedRefs) {
		if (remaining <= 0) break;
		const file = app.vault.getAbstractFileByPath(ref.path);
		if (!(file instanceof TFile)) {
			missing.push(ref.path);
			continue;
		}

		let content = await app.vault.read(file);
		const truncationNote = "\n\n[Content truncated for prompt optimization.]";
		const limit = Math.min(maxDocChars, remaining);
		let localTruncated = false;
		if (content.length > limit) {
			localTruncated = true;
			const sliceLength = Math.max(0, limit - truncationNote.length);
			content = content.slice(0, sliceLength).trimEnd() + truncationNote;
		}
		if (localTruncated) {
			truncated.push(ref.path);
		}
		remaining -= content.length;

		documents.push({
			id: ref.id,
			title: ref.title,
			path: ref.path,
			content,
		});
	}

	return { documents, missing, truncated };
}

function expandTaggedReferences(
	app: App,
	refs: TaggedFileReference[],
	missing: string[]
): TaggedFileReference[] {
	const expanded: TaggedFileReference[] = [];
	const seen = new Set<string>();
	const allFiles = app.vault.getMarkdownFiles();

	const addFile = (file: TFile) => {
		if (seen.has(file.path)) return;
		seen.add(file.path);
		expanded.push({
			id: file.path,
			title: file.basename,
			path: file.path,
			type: "file",
		});
	};

	refs.forEach((ref) => {
		if (ref.type === "folder") {
			const folder = app.vault.getAbstractFileByPath(ref.path);
			if (!(folder instanceof TFolder)) {
				missing.push(ref.path);
				return;
			}
			const prefix = folder.path ? `${folder.path}/` : "";
			allFiles.forEach((file) => {
				if (!prefix || file.path.startsWith(prefix)) {
					addFile(file);
				}
			});
			return;
		}
		if (seen.has(ref.path)) return;
		seen.add(ref.path);
		expanded.push(ref);
	});

	return expanded;
}
