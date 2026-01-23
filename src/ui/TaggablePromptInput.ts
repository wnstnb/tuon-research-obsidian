import { App, TFile, TFolder, setIcon } from "obsidian";
import { TaggedFileReference } from "../utils/taggedDocuments";

export type TaggablePromptInputValue = {
	text: string;
	tags: TaggedFileReference[];
};

type MenuMode = "category" | "files" | "folders";

type MenuItem =
	| {
			kind: "action";
			id: "active-note";
			title: string;
			subtitle?: string;
			ref?: TaggedFileReference;
			disabled?: boolean;
	  }
	| {
			kind: "category";
			id: "files" | "folders";
			title: string;
			subtitle?: string;
	  }
	| {
			kind: "file";
			title: string;
			subtitle?: string;
			ref: TaggedFileReference;
	  }
	| {
			kind: "folder";
			title: string;
			subtitle?: string;
			ref: TaggedFileReference;
	  }
	| {
			kind: "empty";
			title: string;
	  };

type TaggablePromptInputOptions = {
	app: App;
	container: HTMLElement;
	placeholder?: string;
	inputClassName?: string;
	initialText?: string;
	initialTags?: TaggedFileReference[];
	maxChars?: number;
	onChange?: (value: TaggablePromptInputValue) => void;
};

type MentionState = {
	node: Text;
	startOffset: number;
};

const MAX_SUGGESTIONS = 20;

export class TaggablePromptInput {
	private app: App;
	private rootEl: HTMLDivElement;
	private editorEl: HTMLDivElement;
	private counterEl: HTMLDivElement;
	private maxChars: number;
	private menuEl: HTMLDivElement;
	private menuPreviewEl: HTMLDivElement;
	private menuPreviewLabelEl: HTMLDivElement;
	private menuPreviewTitleEl: HTMLDivElement;
	private menuPreviewPathEl: HTMLDivElement;
	private menuPreviewContentEl: HTMLDivElement;
	private menuListEl: HTMLDivElement;
	private menuItems: MenuItem[] = [];
	private menuIndex = 0;
	private menuMode: MenuMode = "category";
	private menuPinnedMode: MenuMode | null = null;
	private menuQuery = "";
	private previewRequestId = 0;
	private menuAnchor: { node: Text; startOffset: number; rect: DOMRect } | null = null;
	private mention: MentionState | null = null;
	private onChange?: (value: TaggablePromptInputValue) => void;

	private readonly handleInputBound = () => this.handleInput();
	private readonly handleKeydownBound = (event: KeyboardEvent) => this.handleKeydown(event);
	private readonly handleClickBound = () => this.handleInput();
	private readonly handleBlurBound = () => this.closeMenu();
	private readonly handlePasteBound = (event: ClipboardEvent) => this.handlePaste(event);

	constructor(options: TaggablePromptInputOptions) {
		this.app = options.app;
		this.onChange = options.onChange;
		this.maxChars = options.maxChars ?? 4096;

		this.rootEl = options.container.createDiv({ cls: "tuon-tag-input" });
		this.counterEl = this.rootEl.createDiv({
			cls: "tuon-tag-input-counter",
		});
		this.editorEl = this.rootEl.createDiv({
			cls: "tuon-tag-input-editor",
			attr: {
				contenteditable: "true",
				role: "textbox",
				"aria-multiline": "true",
				"data-placeholder": options.placeholder ?? "",
				"aria-label": options.placeholder ?? "Prompt input",
			},
		});
		if (options.inputClassName) {
			this.editorEl.addClass(options.inputClassName);
		}

		this.menuEl = this.rootEl.createDiv({
			cls: "tuon-tag-input-menu is-hidden",
		});
		this.menuPreviewEl = this.menuEl.createDiv({
			cls: "tuon-tag-input-preview is-hidden",
		});
		this.menuPreviewLabelEl = this.menuPreviewEl.createDiv({
			cls: "tuon-tag-input-preview-label",
			text: "Preview",
		});
		this.menuPreviewTitleEl = this.menuPreviewEl.createDiv({
			cls: "tuon-tag-input-preview-title",
		});
		this.menuPreviewPathEl = this.menuPreviewEl.createDiv({
			cls: "tuon-tag-input-preview-path",
		});
		this.menuPreviewContentEl = this.menuPreviewEl.createDiv({
			cls: "tuon-tag-input-preview-content",
		});
		this.menuListEl = this.menuEl.createDiv({
			cls: "tuon-tag-input-menu-list",
		});

		this.editorEl.addEventListener("input", this.handleInputBound);
		this.editorEl.addEventListener("keydown", this.handleKeydownBound);
		this.editorEl.addEventListener("click", this.handleClickBound);
		this.editorEl.addEventListener("blur", this.handleBlurBound);
		this.editorEl.addEventListener("paste", this.handlePasteBound);

		this.setValue(options.initialText ?? "", options.initialTags ?? []);
		this.emitChange();
	}

	destroy(): void {
		this.editorEl.removeEventListener("input", this.handleInputBound);
		this.editorEl.removeEventListener("keydown", this.handleKeydownBound);
		this.editorEl.removeEventListener("click", this.handleClickBound);
		this.editorEl.removeEventListener("blur", this.handleBlurBound);
		this.editorEl.removeEventListener("paste", this.handlePasteBound);
		this.menuEl.remove();
		this.editorEl.remove();
		this.rootEl.remove();
	}

	focus(): void {
		this.editorEl.focus();
	}

	getValue(): TaggablePromptInputValue {
		return {
			text: this.getText(),
			tags: this.getTagsFromEditor(),
		};
	}

	setValue(text: string, tags: TaggedFileReference[]): void {
		this.editorEl.empty();
		if (!tags.length) {
			this.editorEl.appendChild(document.createTextNode(text));
			return;
		}

		const tagByTitle = new Map(tags.map((tag) => [tag.title, tag]));
		const escapedTitles = tags.map((tag) => this.escapeRegExp(tag.title));
		const mentionRegex = new RegExp(`@(${escapedTitles.join("|")})`, "g");

		const usedTagIds = new Set<string>();
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = mentionRegex.exec(text)) !== null) {
			const before = text.slice(lastIndex, match.index);
			if (before) this.editorEl.appendChild(document.createTextNode(before));

			const title = match[1];
			if (!title) {
				this.editorEl.appendChild(document.createTextNode(match[0]));
				lastIndex = match.index + match[0].length;
				continue;
			}
			const tag = tagByTitle.get(title);
			if (tag) {
				this.editorEl.appendChild(this.buildTagPill(tag, true));
				usedTagIds.add(tag.id);
			} else {
				this.editorEl.appendChild(document.createTextNode(match[0]));
			}
			lastIndex = match.index + match[0].length;
		}

		const remaining = text.slice(lastIndex);
		if (remaining) this.editorEl.appendChild(document.createTextNode(remaining));

		const unplaced = tags.filter((tag) => !usedTagIds.has(tag.id));
		if (unplaced.length) {
			const needsSpace = text.length > 0 && !text.endsWith(" ");
			if (needsSpace) {
				this.editorEl.appendChild(document.createTextNode(" "));
			}
			unplaced.forEach((tag) => {
				this.editorEl.appendChild(this.buildTagPill(tag, false));
				this.editorEl.appendChild(document.createTextNode(" "));
			});
		}
	}

	private handleInput(): void {
		this.emitChange();
		const mentionQuery = this.getMentionQuery();
		if (mentionQuery === null) {
			this.closeMenu();
			return;
		}
		this.openMenu(mentionQuery);
	}

	private handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Backspace") {
			if (this.maybeRemovePreviousTag(event)) {
				return;
			}
		}

		if (!this.isMenuOpen()) return;

		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.moveSelection(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			this.moveSelection(-1);
		} else if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			const selected = this.menuItems[this.menuIndex];
			if (selected) this.handleMenuSelect(selected);
		} else if (event.key === "Escape") {
			event.preventDefault();
			this.closeMenu();
		}
	}

	private handlePaste(event: ClipboardEvent): void {
		const text = event.clipboardData?.getData("text/plain") ?? "";
		if (!text) return;
		event.preventDefault();
		document.execCommand("insertText", false, text);
	}

	private maybeRemovePreviousTag(event: KeyboardEvent): boolean {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return false;
		const range = selection.getRangeAt(0);
		if (!range.collapsed) return false;

		const container = range.startContainer;
		const offset = range.startOffset;

		if (container.nodeType === Node.TEXT_NODE) {
			if (offset > 0) return false;
			const prev = container.previousSibling;
			if (this.isTagPill(prev)) {
				event.preventDefault();
				prev?.remove();
				this.emitChange();
				return true;
			}
			return false;
		}

		if (container.nodeType === Node.ELEMENT_NODE) {
			const element = container as HTMLElement;
			const prev = element.childNodes[offset - 1];
			if (this.isTagPill(prev)) {
				event.preventDefault();
				prev?.remove();
				this.emitChange();
				return true;
			}
		}

		return false;
	}

	private getMentionQuery(): string | null {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			this.mention = null;
			return null;
		}
		const range = selection.getRangeAt(0);
		if (!range.collapsed) {
			this.mention = null;
			return null;
		}
		const normalized = this.normalizeSelection(range);
		if (!normalized.node) {
			this.mention = null;
			return null;
		}

		const text = normalized.node.textContent ?? "";
		const before = text.slice(0, normalized.offset);
		const atIndex = before.lastIndexOf("@");
		if (atIndex === -1) {
			this.mention = null;
			return null;
		}
		const charBefore = atIndex > 0 ? before[atIndex - 1] : "";
		if (charBefore && !/\s/.test(charBefore)) {
			this.mention = null;
			return null;
		}
		const query = before.slice(atIndex + 1);
		if (/[\r\n]/.test(query)) {
			this.mention = null;
			return null;
		}

		this.mention = { node: normalized.node, startOffset: atIndex };
		return query;
	}

	private normalizeSelection(
		range: Range
	): { node: Text | null; offset: number } {
		const container = range.startContainer;
		const offset = range.startOffset;
		if (container.nodeType === Node.TEXT_NODE) {
			return { node: container as Text, offset };
		}
		if (container.nodeType === Node.ELEMENT_NODE) {
			const element = container as HTMLElement;
			const before = element.childNodes[offset - 1];
			if (before && before.nodeType === Node.TEXT_NODE) {
				return {
					node: before as Text,
					offset: (before.textContent ?? "").length,
				};
			}
			const at = element.childNodes[offset];
			if (at && at.nodeType === Node.TEXT_NODE) {
				return { node: at as Text, offset: 0 };
			}
		}
		return { node: null, offset: 0 };
	}

	private openMenu(query: string): void {
		this.menuQuery = query;
		const trimmedQuery = query.trim();
		const hasQuery = trimmedQuery.length > 0;
		if (this.menuPinnedMode) {
			this.menuMode = this.menuPinnedMode;
		} else if (hasQuery) {
			this.menuMode = "files";
		} else {
			this.menuMode = "category";
		}

		if (this.menuMode === "category") {
			this.menuItems = this.buildCategoryItems();
		} else if (this.menuMode === "folders") {
			this.menuItems = this.buildFolderItems(trimmedQuery);
		} else {
			this.menuItems = this.buildFileItems(trimmedQuery);
		}

		if (this.menuItems.length === 0) {
			this.closeMenu();
			return;
		}

		this.menuIndex = this.getNextSelectableIndex(
			Math.min(this.menuIndex, this.menuItems.length - 1),
			1,
			true
		);
		this.renderMenu();
		this.menuEl.removeClass("is-hidden");
		this.updateMenuAnchor();
		this.positionMenu();
		void this.updatePreviewForSelection();
	}

	private closeMenu(): void {
		this.menuItems = [];
		this.menuIndex = 0;
		this.menuMode = "category";
		this.menuPinnedMode = null;
		this.menuQuery = "";
		this.menuAnchor = null;
		this.mention = null;
		this.menuEl.addClass("is-hidden");
		this.menuListEl.empty();
		this.hidePreview();
	}

	private isMenuOpen(): boolean {
		return !this.menuEl.hasClass("is-hidden") && this.menuItems.length > 0;
	}

	private renderMenu(): void {
		this.menuListEl.empty();
		this.menuItems.forEach((item, index) => {
			const button = this.menuListEl.createEl("button", {
				cls: "tuon-tag-input-menu-item",
				attr: { type: "button" },
			});
			button.toggleClass("is-active", index === this.menuIndex);

			if (item.kind === "empty") {
				button.addClass("is-disabled");
				button.disabled = true;
				button.createSpan({ text: item.title, cls: "tuon-tag-input-menu-title" });
				return;
			}

			if (item.kind === "action") {
				button.addClass("is-action");
				if (item.disabled) {
					button.addClass("is-disabled");
					button.disabled = true;
				}
				const row = this.renderMenuRow(button, item);
				button.addEventListener("mouseenter", () => {
					this.menuIndex = index;
					this.updateMenuActiveState();
				});
				button.addEventListener("mousedown", (event) => {
					event.preventDefault();
					this.handleMenuSelect(item);
				});
				return;
			}

			if (item.kind === "category") {
				button.addClass("is-category");
				const row = this.renderMenuRow(button, item);
				row.createSpan({ text: "›", cls: "tuon-tag-input-menu-arrow" });
				button.addEventListener("mouseenter", () => {
					this.menuIndex = index;
					this.updateMenuActiveState();
				});
				button.addEventListener("mousedown", (event) => {
					event.preventDefault();
					this.handleMenuSelect(item);
				});
				return;
			}

			this.renderMenuRow(button, item);
			button.addEventListener("mouseenter", () => {
				this.menuIndex = index;
				this.updateMenuActiveState();
				void this.updatePreviewForSelection();
			});
			button.addEventListener("mousedown", (event) => {
				event.preventDefault();
				this.handleMenuSelect(item);
			});
		});
	}

	private renderMenuRow(
		button: HTMLButtonElement,
		item: MenuItem
	): HTMLDivElement {
		const row = button.createDiv({ cls: "tuon-tag-input-menu-row" });
		const left = row.createDiv({ cls: "tuon-tag-input-menu-left" });
		const iconName = this.getMenuIconName(item);
		if (iconName) {
			const iconWrap = left.createSpan({ cls: "tuon-tag-input-menu-icon" });
			setIcon(iconWrap, iconName);
		}
		const textCol = left.createDiv({ cls: "tuon-tag-input-menu-text" });
		textCol.createSpan({ text: item.title, cls: "tuon-tag-input-menu-title" });
		if ("subtitle" in item && item.subtitle) {
			textCol.createSpan({ text: item.subtitle, cls: "tuon-tag-input-menu-path" });
		}
		return row;
	}

	private getMenuIconName(item: MenuItem): string | null {
		if (item.kind === "category") {
			return item.id === "files" ? "file-text" : "folder-closed";
		}
		if (item.kind === "file") return "file-text";
		if (item.kind === "folder") return "folder-closed";
		if (item.kind === "action" && item.id === "active-note") return "file-text";
		return null;
	}

	private updateMenuActiveState(): void {
		const items = Array.from(
			this.menuListEl.querySelectorAll<HTMLButtonElement>(
				".tuon-tag-input-menu-item"
			)
		);
		items.forEach((item, index) => {
			item.toggleClass("is-active", index === this.menuIndex);
		});
	}

	private positionMenu(): void {
		const rect = this.menuAnchor?.rect ?? this.getSelectionRect();
		if (!rect) return;
		const rootRect = this.rootEl.getBoundingClientRect();

		const editorRect = this.editorEl.getBoundingClientRect();
		const caretTop = rect.height ? rect.top : editorRect.top;
		const caretBottom = rect.height ? rect.bottom : editorRect.bottom;
		const baseLeft = rect.height ? rect.left : editorRect.left;

		const menuHeight = this.menuEl.offsetHeight || 0;
		const spaceBelow = window.innerHeight - caretBottom;
		const spaceAbove = caretTop;
		const shouldFlip = menuHeight > spaceBelow && spaceAbove > spaceBelow;

		const top = shouldFlip
			? caretTop - rootRect.top - menuHeight - 6
			: caretBottom - rootRect.top + 4;
		const left = baseLeft - rootRect.left;

		this.menuEl.style.top = `${Math.max(0, top)}px`;
		this.menuEl.style.left = `${Math.max(0, left)}px`;
	}

	private updateMenuAnchor(): void {
		const mention = this.mention;
		if (!mention) {
			this.menuAnchor = null;
			return;
		}
		if (
			this.menuAnchor &&
			this.menuAnchor.node === mention.node &&
			this.menuAnchor.startOffset === mention.startOffset
		) {
			return;
		}
		const rect = this.getMentionRect(mention);
		if (rect) {
			this.menuAnchor = {
				node: mention.node,
				startOffset: mention.startOffset,
				rect,
			};
		}
	}

	private getSelectionRect(): DOMRect | null {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return null;
		const range = selection.getRangeAt(0);
		return range.getBoundingClientRect();
	}

	private getMentionRect(mention: MentionState): DOMRect | null {
		const text = mention.node.textContent ?? "";
		if (mention.startOffset < 0 || mention.startOffset >= text.length) return null;
		const range = document.createRange();
		try {
			range.setStart(mention.node, mention.startOffset);
			range.setEnd(mention.node, mention.startOffset + 1);
		} catch {
			return null;
		}
		return range.getBoundingClientRect();
	}

	private buildCategoryItems(): MenuItem[] {
		const items: MenuItem[] = [];
		const activeNote = this.getActiveNoteItem();
		if (activeNote) items.push(activeNote);
		items.push({ kind: "category", id: "files", title: "Files" });
		items.push({ kind: "category", id: "folders", title: "Folders" });
		return items;
	}

	private buildFileItems(query: string): MenuItem[] {
		const results = this.filterFiles(query).map((ref) => ({
			kind: "file" as const,
			title: ref.title,
			subtitle: ref.path,
			ref,
		}));
		if (!results.length) {
			return [
				{
					kind: "empty",
					title: query ? "No matching files." : "No files found.",
				},
			];
		}
		return results;
	}

	private buildFolderItems(query: string): MenuItem[] {
		const results = this.filterFolders(query).map((ref) => ({
			kind: "folder" as const,
			title: ref.title,
			subtitle: ref.path,
			ref,
		}));
		if (!results.length) {
			return [
				{
					kind: "empty",
					title: query ? "No matching folders." : "No folders found.",
				},
			];
		}
		return results;
	}

	private getActiveNoteItem(): MenuItem | null {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return {
				kind: "action",
				id: "active-note",
				title: "Active note",
				subtitle: "No active note",
				disabled: true,
			};
		}
		const ref = this.toTaggedFileReference(activeFile);
		return {
			kind: "action",
			id: "active-note",
			title: "Active note",
			subtitle: ref.title,
			ref,
		};
	}

	private isSelectableItem(item: MenuItem): boolean {
		if (item.kind === "empty") return false;
		if (item.kind === "action" && item.disabled) return false;
		return true;
	}

	private getNextSelectableIndex(
		startIndex: number,
		direction: 1 | -1,
		includeStart = false
	): number {
		if (!this.menuItems.length) return 0;
		let index = Math.max(0, Math.min(startIndex, this.menuItems.length - 1));
		for (let i = 0; i < this.menuItems.length; i += 1) {
			const currentItem = this.menuItems[index];
			if (includeStart && currentItem && this.isSelectableItem(currentItem)) {
				return index;
			}
			index = (index + direction + this.menuItems.length) % this.menuItems.length;
			const nextItem = this.menuItems[index];
			if (nextItem && this.isSelectableItem(nextItem)) {
				return index;
			}
		}
		return startIndex;
	}

	private moveSelection(direction: 1 | -1): void {
		if (!this.menuItems.length) return;
		const nextIndex = this.getNextSelectableIndex(this.menuIndex, direction);
		if (nextIndex === this.menuIndex) return;
		this.menuIndex = nextIndex;
		this.updateMenuActiveState();
		void this.updatePreviewForSelection();
	}

	private handleMenuSelect(item: MenuItem): void {
		if (item.kind === "action") {
			if (item.disabled || !item.ref) return;
			this.insertTag(item.ref);
			return;
		}
		if (item.kind === "category") {
			this.menuPinnedMode = item.id;
			this.menuMode = item.id;
			this.menuIndex = 0;
			this.openMenu(this.menuQuery);
			return;
		}
		if (item.kind === "file" || item.kind === "folder") {
			this.insertTag(item.ref);
		}
	}

	private async updatePreviewForSelection(): Promise<void> {
		if (this.menuMode === "category") {
			this.hidePreview();
			return;
		}
		const item = this.menuItems[this.menuIndex];
		if (!item || item.kind !== "file") {
			this.hidePreview();
			return;
		}
		const requestId = ++this.previewRequestId;
		const file = this.app.vault.getAbstractFileByPath(item.ref.path);
		if (!(file instanceof TFile)) {
			this.hidePreview();
			return;
		}
		let content = "";
		try {
			content = await this.app.vault.cachedRead(file);
		} catch {
			content = "";
		}
		if (requestId !== this.previewRequestId) return;

		const cleaned = this.stripFrontmatter(content);
		const trimmed = cleaned.trim();
		const preview =
			trimmed.length > 400 ? `${trimmed.slice(0, 400).trimEnd()}…` : trimmed;
		this.menuPreviewTitleEl.setText(item.ref.title);
		this.menuPreviewPathEl.setText(item.ref.path);
		this.menuPreviewContentEl.setText(preview || "No preview available.");
		this.menuPreviewEl.removeClass("is-hidden");
	}

	private hidePreview(): void {
		this.previewRequestId += 1;
		this.menuPreviewTitleEl.setText("");
		this.menuPreviewPathEl.setText("");
		this.menuPreviewContentEl.setText("");
		this.menuPreviewEl.addClass("is-hidden");
	}

	private stripFrontmatter(content: string): string {
		return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
	}

	private filterFiles(query: string): TaggedFileReference[] {
		const files = this.app.vault.getMarkdownFiles();
		const normalized = query.trim().toLowerCase();
		const tokens = normalized ? normalized.split(/\s+/) : [];
		const scored = files.map((file) => {
			const title = file.basename;
			const lowerTitle = title.toLowerCase();
			const lowerPath = file.path.toLowerCase();
			let score = 0;
			if (!tokens.length) {
				score = 1;
			} else {
				let allMatch = true;
				tokens.forEach((token) => {
					if (!lowerTitle.includes(token) && !lowerPath.includes(token)) {
						allMatch = false;
						return;
					}
					if (lowerTitle.startsWith(token)) score += 4;
					else if (lowerTitle.includes(token)) score += 2;
					else if (lowerPath.includes(token)) score += 1;
				});
				if (!allMatch) score = 0;
				if (normalized && lowerTitle.includes(normalized)) score += 3;
				if (normalized && lowerPath.includes(normalized)) score += 1;
			}
			return { file, score };
		});
		return scored
			.filter((entry) => entry.score > 0)
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				return a.file.basename.localeCompare(b.file.basename);
			})
			.slice(0, MAX_SUGGESTIONS)
			.map(({ file }) => this.toTaggedFileReference(file));
	}

	private filterFolders(query: string): TaggedFileReference[] {
		const folders = this.getAllFolders();
		const normalized = query.trim().toLowerCase();
		const tokens = normalized ? normalized.split(/\s+/) : [];
		const scored = folders.map((folder) => {
			const title = folder.name || folder.path;
			const lowerTitle = title.toLowerCase();
			const lowerPath = folder.path.toLowerCase();
			let score = 0;
			if (!tokens.length) {
				score = 1;
			} else {
				let allMatch = true;
				tokens.forEach((token) => {
					if (!lowerTitle.includes(token) && !lowerPath.includes(token)) {
						allMatch = false;
						return;
					}
					if (lowerTitle.startsWith(token)) score += 4;
					else if (lowerTitle.includes(token)) score += 2;
					else if (lowerPath.includes(token)) score += 1;
				});
				if (!allMatch) score = 0;
				if (normalized && lowerTitle.includes(normalized)) score += 3;
				if (normalized && lowerPath.includes(normalized)) score += 1;
			}
			return { folder, score };
		});
		return scored
			.filter((entry) => entry.score > 0)
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				return a.folder.path.localeCompare(b.folder.path);
			})
			.slice(0, MAX_SUGGESTIONS)
			.map(({ folder }) => this.toTaggedFolderReference(folder));
	}

	private getAllFolders(): TFolder[] {
		const all = this.app.vault.getAllLoadedFiles();
		return all.filter((file) => file instanceof TFolder && file.path !== "") as TFolder[];
	}

	private toTaggedFileReference(file: TFile): TaggedFileReference {
		return {
			id: file.path,
			path: file.path,
			title: file.basename,
			type: "file",
		};
	}

	private toTaggedFolderReference(folder: TFolder): TaggedFileReference {
		const title = folder.name || "Vault";
		return {
			id: folder.path || "vault",
			path: folder.path,
			title,
			type: "folder",
		};
	}

	private insertTag(tag: TaggedFileReference): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const mention = this.mention;
		const range = selection.getRangeAt(0);

		if (mention) {
			const replaceRange = document.createRange();
			replaceRange.setStart(mention.node, mention.startOffset);
			replaceRange.setEnd(range.startContainer, range.startOffset);
			replaceRange.deleteContents();

			const pill = this.buildTagPill(tag);
			replaceRange.insertNode(pill);
			replaceRange.setStartAfter(pill);
			const space = document.createTextNode(" ");
			replaceRange.insertNode(space);

			const caretRange = document.createRange();
			caretRange.setStart(space, 1);
			caretRange.collapse(true);
			selection.removeAllRanges();
			selection.addRange(caretRange);
		} else {
			const pill = this.buildTagPill(tag);
			range.insertNode(pill);
			range.setStartAfter(pill);
			const space = document.createTextNode(" ");
			range.insertNode(space);
			range.setStart(space, 1);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);
		}

		this.closeMenu();
		this.emitChange();
	}

	private buildTagPill(tag: TaggedFileReference, inline = true): HTMLSpanElement {
		const pill = document.createElement("span");
		pill.addClass("tuon-tag-pill");
		if (tag.type === "folder") {
			pill.addClass("tuon-tag-pill-folder");
		}
		pill.setAttr("contenteditable", "false");
		pill.dataset.fileId = tag.id;
		pill.dataset.filePath = tag.path;
		pill.dataset.fileTitle = tag.title;
		pill.dataset.tagType = tag.type ?? "file";
		pill.dataset.inline = inline ? "true" : "false";

		const icon = document.createElement("span");
		icon.addClass("tuon-tag-pill-icon");
		setIcon(icon, tag.type === "folder" ? "folder-closed" : "file-text");
		pill.appendChild(icon);

		const label = document.createElement("span");
		label.addClass("tuon-tag-pill-label");
		label.setText(tag.title);
		pill.appendChild(label);

		const remove = document.createElement("span");
		remove.addClass("tuon-tag-pill-remove");
		remove.setAttr("role", "button");
		remove.setAttr("aria-label", `Remove ${tag.title}`);
		remove.setText("×");
		remove.addEventListener("mousedown", (event) => {
			event.preventDefault();
			pill.remove();
			this.emitChange();
		});
		pill.appendChild(remove);

		return pill;
	}

	private getTagsFromEditor(): TaggedFileReference[] {
		const tags = new Map<string, TaggedFileReference>();
		const pills = Array.from(
			this.editorEl.querySelectorAll<HTMLSpanElement>(".tuon-tag-pill")
		);
		pills.forEach((pill) => {
			const path = pill.dataset.filePath;
			const title = pill.dataset.fileTitle;
			if (!path || !title) return;
			const type = pill.dataset.tagType === "folder" ? "folder" : "file";
			tags.set(path, { id: path, path, title, type });
		});
		return Array.from(tags.values());
	}

	private getText(): string {
		let text = "";
		this.editorEl.childNodes.forEach((node) => {
			text += this.getTextFromNode(node);
		});
		return text.replace(/\n{3,}/g, "\n\n");
	}

	private getTextFromNode(node: Node): string {
		if (node.nodeType === Node.TEXT_NODE) {
			return node.textContent ?? "";
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return "";
		const element = node as HTMLElement;
		if (element.classList.contains("tuon-tag-pill")) {
			const inline = element.dataset.inline !== "false";
			if (!inline) return "";
			const title = element.dataset.fileTitle ?? "document";
			return `@${title}`;
		}
		if (element.tagName === "BR") return "\n";

		let text = "";
		element.childNodes.forEach((child) => {
			text += this.getTextFromNode(child);
		});
		if (element.tagName === "DIV" || element.tagName === "P") {
			text += "\n";
		}
		return text;
	}

	private isTagPill(node: Node | null | undefined): boolean {
		return !!node && node.nodeType === Node.ELEMENT_NODE &&
			(node as HTMLElement).classList.contains("tuon-tag-pill");
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private emitChange(): void {
		this.updateCounter();
		if (!this.onChange) return;
		this.onChange(this.getValue());
	}

	private updateCounter(): void {
		const length = this.getText().length;
		this.counterEl.setText(`${length} / ${this.maxChars}`);
	}
}
