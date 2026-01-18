import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { ResearchRepo, ResearchEventRow, ResearchJobRow } from "../db/researchRepo";

export const VIEW_TYPE_RESEARCH_JOBS = "tuon-research-jobs";

export class ResearchJobsView extends ItemView {
	private repo: ResearchRepo;
	private selectedJobId: string | null = null;

	constructor(leaf: WorkspaceLeaf, repo: ResearchRepo) {
		super(leaf);
		this.repo = repo;
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

		const header = container.createEl("div", { cls: "tuon-research-header" });
		header.createEl("h3", { text: "Deep Research Jobs" });
		const refresh = header.createEl("button", { text: "Refresh" });
		refresh.addEventListener("click", () => void this.render());

		const layout = container.createEl("div", { cls: "tuon-research-layout" });
		const listEl = layout.createEl("div", { cls: "tuon-research-list" });
		const detailEl = layout.createEl("div", { cls: "tuon-research-detail" });

		const jobs = this.repo.listJobs(100);
		if (!jobs.length) {
			listEl.createEl("div", { text: "No research jobs yet." });
		} else {
			jobs.forEach((job) => {
				const button = listEl.createEl("button", {
					text: job.title || job.original_query || job.instructions || job.job_id,
					cls: this.selectedJobId === job.job_id ? "is-active" : "",
				});
				button.addEventListener("click", () => {
					this.selectedJobId = job.job_id;
					void this.render();
				});
			});
		}

		const selectedJob = this.selectedJobId
			? this.repo.getJob(this.selectedJobId)
			: jobs[0] ?? null;
		if (!this.selectedJobId && selectedJob) {
			this.selectedJobId = selectedJob.job_id;
		}

		if (!selectedJob) {
			detailEl.createEl("div", { text: "Select a job to view details." });
			return;
		}

		this.renderDetail(detailEl, selectedJob);
	}

	private renderDetail(container: HTMLElement, job: ResearchJobRow) {
		container.empty();
		container.createEl("h4", { text: job.title || "Research job" });
		container.createEl("div", { text: `Status: ${job.status}` });
		if (typeof job.progress === "number") {
			container.createEl("div", { text: `Progress: ${job.progress}%` });
		}
		if (job.created_at) {
			container.createEl("div", { text: `Created: ${job.created_at}` });
		}
		if (job.completed_at) {
			container.createEl("div", { text: `Completed: ${job.completed_at}` });
		}
		if (job.report_note_path) {
			const row = container.createEl("div");
			row.createEl("span", { text: `Report: ${job.report_note_path}` });
			const openBtn = row.createEl("button", { text: "Open" });
			openBtn.addEventListener("click", () => {
				const file = this.app.vault.getAbstractFileByPath(job.report_note_path || "");
				if (file instanceof TFile) {
					void this.app.workspace.getLeaf().openFile(file);
				}
			});
		}

		container.createEl("h5", { text: "Events" });
		const events = this.repo.listEvents(job.job_id, 200);
		if (!events.length) {
			container.createEl("div", { text: "No events yet." });
		} else {
			const list = container.createEl("ul");
			events.forEach((evt) => {
				const item = list.createEl("li");
				item.createEl("span", { text: `${evt.created_at} — ${evt.message}` });
			});
		}
	}
}
