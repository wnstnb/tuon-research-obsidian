import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { optimizePrompt } from "../ai/promptOptimizer";
import { ResearchRepo, ResearchJobRow } from "../db/researchRepo";
import { ResearchJobManager } from "../research/jobManager";
import { DeepResearchSettings } from "../settings";

export const VIEW_TYPE_RESEARCH_JOBS = "tuon-research-jobs";

type JobsTab = "instructions" | "history";

export class ResearchJobsView extends ItemView {
	private repo: ResearchRepo;
	private settings: DeepResearchSettings;
	private jobManager: ResearchJobManager;
	private selectedJobId: string | null = null;
	private activeTab: JobsTab = "instructions";
	private promptDraft = "";
	private optimizedPrompt = "";
	private lastRawPrompt = "";
	private optimizing = false;
	private submitting = false;
	private detailInstructionsCollapsed = true;
	private historySearch = "";
	private detailEventsCollapsed = true;
	private detailJsonCollapsed = true;

	constructor(
		leaf: WorkspaceLeaf,
		repo: ResearchRepo,
		settings: DeepResearchSettings,
		jobManager: ResearchJobManager
	) {
		super(leaf);
		this.repo = repo;
		this.settings = settings;
		this.jobManager = jobManager;
	}

	getViewType(): string {
		return VIEW_TYPE_RESEARCH_JOBS;
	}

	getDisplayText(): string {
		return "Deep Research Jobs";
	}

	async onOpen() {
		await this.render();
	}

	async render(): Promise<void> {
		const container = this.containerEl;
		container.empty();
		container.addClass("tuon-research-jobs-view");

		const header = container.createEl("div", { cls: "tuon-dr-header" });
		header.createEl("div", { text: "Deep Research Jobs", cls: "tuon-dr-title" });
		const headerActions = header.createDiv({ cls: "tuon-dr-header-actions" });
		const refresh = headerActions.createEl("button", { text: "Refresh", cls: "tuon-dr-button" });
		refresh.addEventListener("click", () => void this.render());

		const body = container.createEl("div", { cls: "tuon-dr-body" });
		const tabsList = body.createEl("div", { cls: "tuon-dr-tabs-list" });
		const instructionsTab = tabsList.createEl("button", {
			text: "Instructions",
			cls: `tuon-dr-tab ${this.activeTab === "instructions" ? "is-active" : ""}`,
		});
		instructionsTab.addEventListener("click", () => {
			this.activeTab = "instructions";
			void this.render();
		});

		const historyTab = tabsList.createEl("button", {
			text: "History",
			cls: `tuon-dr-tab ${this.activeTab === "history" ? "is-active" : ""}`,
		});
		historyTab.addEventListener("click", () => {
			this.activeTab = "history";
			void this.render();
		});

		const panels = body.createEl("div", { cls: "tuon-dr-panels" });
		const instructionsPanel = panels.createEl("div", {
			cls: `tuon-dr-panel ${this.activeTab === "instructions" ? "is-active" : ""}`,
		});
		const historyPanel = panels.createEl("div", {
			cls: `tuon-dr-panel ${this.activeTab === "history" ? "is-active" : ""}`,
		});

		this.renderInstructionsTab(instructionsPanel);
		this.renderHistoryTab(historyPanel);
	}

	private renderInstructionsTab(container: HTMLElement) {
		container.empty();
		const section = container.createEl("div", { cls: "tuon-dr-section" });
		section.createEl("label", { text: "Research Instructions", cls: "tuon-dr-label" });
		section.createEl("div", {
			text: "Describe what you want to research. Be specific about the topic and scope.",
			cls: "tuon-dr-helper",
		});

		const actionRow = section.createEl("div", { cls: "tuon-dr-action-row" });
		const actions = actionRow.createEl("div", { cls: "tuon-dr-actions" });
		const optimizeButton = actions.createEl("button", {
			cls: "tuon-dr-button tuon-dr-button-with-spinner",
		});
		if (this.optimizing) {
			optimizeButton.createSpan({ text: "Optimizing" });
			optimizeButton.createSpan({ cls: "tuon-dr-spinner", attr: { "aria-hidden": "true" } });
		} else {
			optimizeButton.createSpan({ text: "Optimize" });
		}
		optimizeButton.disabled = this.optimizing || !this.promptDraft.trim();
		optimizeButton.addEventListener("click", () => void this.handleOptimize());

		const submitButton = actions.createEl("button", {
			text: this.submitting ? "Running..." : "Run research",
			cls: "tuon-dr-button tuon-dr-primary",
		});
		submitButton.disabled =
			this.submitting || this.optimizing || !this.promptDraft.trim();
		submitButton.addEventListener("click", () => void this.handleSubmit());

		const updateButtonState = () => {
			const hasPrompt = !!this.promptDraft.trim();
			optimizeButton.disabled = this.optimizing || !hasPrompt;
			submitButton.disabled = this.submitting || this.optimizing || !hasPrompt;
		};

		const inputCard = section.createEl("div", { cls: "tuon-dr-input-card" });
		const textarea = inputCard.createEl("textarea", {
			cls: "tuon-dr-textarea",
			attr: { placeholder: "Enter your research instructions..." },
		});
		textarea.value = this.promptDraft;
		textarea.addEventListener("input", () => {
			this.promptDraft = textarea.value;
			if (this.optimizedPrompt && textarea.value !== this.optimizedPrompt) {
				this.optimizedPrompt = "";
				this.lastRawPrompt = "";
			}
			updateButtonState();
		});
		updateButtonState();
	}

	private renderHistoryTab(container: HTMLElement) {
		container.empty();
		const jobs = this.repo.listJobs(100);
		const selectedJob = this.selectedJobId ? this.repo.getJob(this.selectedJobId) : null;
		if (this.selectedJobId && !selectedJob) {
			this.selectedJobId = null;
		}

		if (this.selectedJobId && selectedJob) {
			this.renderHistoryDetail(container, selectedJob);
			return;
		}

		this.renderHistoryList(container, jobs);
	}

	private renderHistoryList(container: HTMLElement, jobs: ResearchJobRow[]) {
		const controls = container.createEl("div", { cls: "tuon-dr-history-controls" });
		const searchInput = controls.createEl("input", {
			cls: "tuon-dr-history-search",
			attr: { type: "text", placeholder: "Search history..." },
		});
		searchInput.value = this.historySearch;
		searchInput.addEventListener("input", () => {
			this.historySearch = searchInput.value;
			void this.render();
		});

		const query = this.historySearch.trim().toLowerCase();
		const filtered = query
			? jobs.filter((job) => this.getJobSearchText(job).includes(query))
			: jobs;

		if (!filtered.length) {
			container.createEl("div", {
				text: query ? "No matching jobs." : "No research jobs yet.",
				cls: "tuon-dr-empty",
			});
			return;
		}

		const list = container.createEl("div", { cls: "tuon-dr-history-list" });
		let lastLabel = "";
		filtered.forEach((job) => {
			const label = this.getHistoryDateLabel(job.created_at);
			if (label !== lastLabel) {
				list.createEl("div", { text: label, cls: "tuon-dr-history-date" });
				lastLabel = label;
			}
			const button = list.createEl("button", { cls: "tuon-dr-history-item" });
			button.addEventListener("click", () => {
				this.selectedJobId = job.job_id;
				this.resetDetailCollapses();
				void this.render();
			});

			button.createEl("div", {
				text: job.title || job.original_query || job.instructions || job.job_id,
				cls: "tuon-dr-history-title",
			});
			const metaParts = [job.status];
			if (job.created_at) {
				metaParts.push(this.formatTimestamp(job.created_at));
			}
			button.createEl("div", {
				text: metaParts.filter(Boolean).join(" • "),
				cls: "tuon-dr-history-meta",
			});
		});
	}

	private renderHistoryDetail(container: HTMLElement, job: ResearchJobRow) {
		const header = container.createEl("div", { cls: "tuon-dr-detail-header" });
		const backButton = header.createEl("button", { text: "Back", cls: "tuon-dr-back" });
		backButton.addEventListener("click", () => {
			this.selectedJobId = null;
			void this.render();
		});

		const titleWrap = header.createEl("div", { cls: "tuon-dr-detail-title" });
		titleWrap.createEl("div", {
			text: job.title || job.original_query || "Research job",
			cls: "tuon-dr-detail-heading",
		});
		titleWrap.createEl("div", {
			text: `Status: ${job.status}${typeof job.progress === "number" ? ` • ${job.progress}%` : ""}`,
			cls: "tuon-dr-detail-status",
		});

		const instructionsCard = container.createEl("div", { cls: "tuon-dr-card" });
		const instructionsToggle = instructionsCard.createEl("button", {
			cls: "tuon-dr-card-toggle",
			attr: { type: "button" },
		});
		instructionsToggle.createSpan({ text: "Research Instructions", cls: "tuon-dr-card-title" });
		const instructionsActions = instructionsToggle.createSpan({ cls: "tuon-dr-card-toggle-actions" });
		instructionsActions.createSpan({
			text: this.detailInstructionsCollapsed ? "Show" : "Hide",
			cls: "tuon-dr-card-toggle-label",
		});
		const instructionsCopy = instructionsActions.createEl("button", {
			cls: "tuon-dr-copy-button",
			attr: { type: "button", "aria-label": "Copy research instructions" },
		});
		setIcon(instructionsCopy, "copy");
		instructionsCopy.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.copyToClipboard(instructionsText, "Copied research instructions.");
		});
		instructionsToggle.addEventListener("click", () => {
			this.detailInstructionsCollapsed = !this.detailInstructionsCollapsed;
			void this.render();
		});

		const instructionsText =
			job.instructions || job.original_query || "No instructions recorded.";
		instructionsCard.createEl("div", {
			text: this.detailInstructionsCollapsed
				? this.getCollapsedText(instructionsText, 10)
				: instructionsText,
			cls: "tuon-dr-card-content tuon-dr-card-body",
		});

		const metaCard = container.createEl("div", { cls: "tuon-dr-card" });
		metaCard.createEl("div", { text: "Timeline", cls: "tuon-dr-card-title" });
		metaCard.createEl("div", {
			text: `Created: ${job.created_at ? this.formatTimestamp(job.created_at) : "—"}`,
			cls: "tuon-dr-card-content",
		});
		metaCard.createEl("div", {
			text: `Completed: ${job.completed_at ? this.formatTimestamp(job.completed_at) : "—"}`,
			cls: "tuon-dr-card-content",
		});

		const reportCard = container.createEl("div", { cls: "tuon-dr-card" });
		reportCard.createEl("div", { text: "Report", cls: "tuon-dr-card-title" });
		if (job.report_note_path) {
			const row = reportCard.createEl("div", { cls: "tuon-dr-card-content" });
			row.createEl("span", { text: job.report_note_path });
			const openBtn = row.createEl("button", { text: "Open", cls: "tuon-dr-button" });
			openBtn.addEventListener("click", () => {
				const file = this.app.vault.getAbstractFileByPath(job.report_note_path || "");
				if (file instanceof TFile) {
					void this.app.workspace.getLeaf().openFile(file);
				}
			});
		} else {
			reportCard.createEl("div", {
				text: "No report note yet.",
				cls: "tuon-dr-card-content",
			});
		}

		const jsonCard = container.createEl("div", { cls: "tuon-dr-card" });
		const jsonToggle = jsonCard.createEl("button", {
			cls: "tuon-dr-card-toggle",
			attr: { type: "button" },
		});
		jsonToggle.createSpan({ text: "Raw results (JSON)", cls: "tuon-dr-card-title" });
		const jsonActions = jsonToggle.createSpan({ cls: "tuon-dr-card-toggle-actions" });
		jsonActions.createSpan({
			text: this.detailJsonCollapsed ? "Show" : "Hide",
			cls: "tuon-dr-card-toggle-label",
		});
		const jsonText = this.formatJson(job.results);
		const jsonCopy = jsonActions.createEl("button", {
			cls: "tuon-dr-copy-button",
			attr: { type: "button", "aria-label": "Copy raw results JSON" },
		});
		setIcon(jsonCopy, "copy");
		jsonCopy.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.copyToClipboard(jsonText, "Copied raw results JSON.");
		});
		jsonToggle.addEventListener("click", () => {
			this.detailJsonCollapsed = !this.detailJsonCollapsed;
			void this.render();
		});
		if (!this.detailJsonCollapsed) {
			jsonCard.createEl("div", {
				text: jsonText,
				cls: "tuon-dr-card-content tuon-dr-card-body tuon-dr-json",
			});
		}

		const eventsCard = container.createEl("div", { cls: "tuon-dr-card" });
		const eventsToggle = eventsCard.createEl("button", {
			cls: "tuon-dr-card-toggle",
			attr: { type: "button" },
		});
		eventsToggle.createSpan({ text: "Events", cls: "tuon-dr-card-title" });
		const eventsActions = eventsToggle.createSpan({ cls: "tuon-dr-card-toggle-actions" });
		eventsActions.createSpan({
			text: this.detailEventsCollapsed ? "Show" : "Hide",
			cls: "tuon-dr-card-toggle-label",
		});
		const events = this.repo.listEvents(job.job_id, 200);
		const eventsText = events.length
			? events.map((evt) => `${evt.created_at ?? ""} — ${evt.message}`).join("\n")
			: "No events yet.";
		const eventsCopy = eventsActions.createEl("button", {
			cls: "tuon-dr-copy-button",
			attr: { type: "button", "aria-label": "Copy events" },
		});
		setIcon(eventsCopy, "copy");
		eventsCopy.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.copyToClipboard(eventsText, "Copied events.");
		});
		eventsToggle.addEventListener("click", () => {
			this.detailEventsCollapsed = !this.detailEventsCollapsed;
			void this.render();
		});
		if (!this.detailEventsCollapsed) {
			if (!events.length) {
				eventsCard.createEl("div", {
					text: "No events yet.",
					cls: "tuon-dr-card-content tuon-dr-card-body",
				});
			} else {
				const list = eventsCard.createEl("div", {
					cls: "tuon-dr-events tuon-dr-card-body",
				});
				events.forEach((evt) => {
					list.createEl("div", {
						text: `${evt.created_at ?? ""} — ${evt.message}`,
						cls: "tuon-dr-event-item",
					});
				});
			}
		}
	}

	private async handleOptimize() {
		const rawPrompt = this.promptDraft.trim();
		if (!rawPrompt) {
			new Notice("Enter a prompt first.");
			return;
		}
		if (!this.settings.openRouterApiKey?.trim()) {
			new Notice("Missing OpenRouter API key. Set it in plugin settings.");
			return;
		}
		this.optimizing = true;
		void this.render();
		try {
			this.optimizedPrompt = await optimizePrompt(
				{
					apiKey: this.settings.openRouterApiKey,
					model: this.settings.openRouterModel,
					referer: this.settings.openRouterReferer,
					appTitle: this.settings.openRouterAppTitle,
				},
				rawPrompt
			);
			this.lastRawPrompt = rawPrompt;
			this.promptDraft = this.optimizedPrompt;
			new Notice("Prompt optimized.");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Prompt optimization failed: ${msg}`);
		} finally {
			this.optimizing = false;
			void this.render();
		}
	}

	private async handleSubmit() {
		const rawPrompt = this.promptDraft.trim();
		if (!rawPrompt) {
			new Notice("Enter a prompt first.");
			return;
		}

		const optimizedPrompt = this.optimizedPrompt.trim();
		const promptToUse = optimizedPrompt ? optimizedPrompt : rawPrompt;
		const usedOptimized = !!optimizedPrompt;
		const originalPrompt = this.lastRawPrompt || rawPrompt;
		const now = new Date().toISOString();
		this.submitting = true;
		void this.render();
		try {
			const jobId = await this.jobManager.submitJob({
				originalPrompt,
				optimizedPrompt: promptToUse,
				optimizerMeta: {
					optimizedAt: usedOptimized ? now : null,
					model: this.settings.openRouterModel,
					autoOptimize: false,
					usedOptimized,
				},
			});
			this.promptDraft = "";
			this.optimizedPrompt = "";
			this.lastRawPrompt = "";
			this.selectedJobId = jobId;
			this.activeTab = "history";
			this.resetDetailCollapses();
			new Notice("Research job submitted.");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Research submission failed: ${msg}`);
		} finally {
			this.submitting = false;
			void this.render();
		}
	}

	private resetDetailCollapses(): void {
		this.detailInstructionsCollapsed = true;
		this.detailEventsCollapsed = true;
		this.detailJsonCollapsed = true;
	}

	private getCollapsedText(text: string, maxLines = 10): string {
		const lines = text.split(/\r?\n/);
		if (lines.length <= maxLines) return text;
		return `${lines.slice(0, maxLines).join("\n")}\n...`;
	}

	private formatJson(value: string | null): string {
		if (!value) return "No JSON stored yet.";
		try {
			const parsed = JSON.parse(value);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return value;
		}
	}

	private getHistoryDateLabel(value: string | null): string {
		if (!value) return "Unknown date";
		const date = this.parseTimestamp(value);
		if (Number.isNaN(date.getTime())) return "Unknown date";
		const now = new Date();
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
		const diffDays = Math.round((startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24));
		if (diffDays === 0) return "Today";
		if (diffDays === 1) return "Yesterday";
		return date.toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	}

	private getJobSearchText(job: ResearchJobRow): string {
		return [
			job.title,
			job.original_query,
			job.instructions,
			job.job_id,
			job.status,
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
	}

	private async copyToClipboard(text: string, successMessage: string): Promise<void> {
		if (!text.trim()) {
			new Notice("Nothing to copy.");
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			new Notice(successMessage);
			return;
		} catch {
			// Fallback for environments without clipboard API permissions.
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			try {
				document.execCommand("copy");
				new Notice(successMessage);
			} finally {
				document.body.removeChild(textarea);
			}
		}
	}

	private parseTimestamp(value: string): Date {
		const trimmed = (value || "").trim();
		if (!trimmed) return new Date(NaN);
		const hasTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed);
		let normalized = trimmed;
		if (!hasTimezone) {
			// If the backend omits timezone info, assume UTC to avoid day drift.
			normalized = trimmed.replace(/\s+/, "T") + "Z";
		}
		return new Date(normalized);
	}

	private formatTimestamp(value: string): string {
		const date = this.parseTimestamp(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleString();
	}
}
