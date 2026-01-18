import { Notice } from "obsidian";
import { ResearchRepo, ResearchJobRow, ResearchEventRow } from "../db/researchRepo";
import { DeepResearchClient, JobStatusResponse } from "./deepResearchClient";
import { ReportNoteWriter } from "./reportNoteWriter";

type PromptContext = {
	originalPrompt: string;
	optimizedPrompt: string;
	optimizerMeta: Record<string, any>;
	taggedDocuments?: Array<Record<string, any>>;
};

type JobStateCache = {
	status?: string;
	progress?: number | null;
};

export class ResearchJobManager {
	private polls = new Map<string, number>();
	private cache = new Map<string, JobStateCache>();

	constructor(
		private repo: ResearchRepo,
		private client: DeepResearchClient,
		private noteWriter: ReportNoteWriter,
		private userId: string,
		private pollIntervalMs: number,
		private outputFolder: string,
		private includePromptSection: boolean
	) {}

	updateConfig(pollIntervalMs: number, outputFolder: string, includePromptSection: boolean) {
		this.pollIntervalMs = pollIntervalMs;
		this.outputFolder = outputFolder;
		this.includePromptSection = includePromptSection;
	}

	async submitJob(payload: PromptContext): Promise<string> {
		const response = await this.client.submitEnhancedJob({
			instructions: payload.optimizedPrompt,
			tagged_documents: payload.taggedDocuments ?? [],
		});

		const now = new Date().toISOString();
		this.repo.upsertJob({
			job_id: response.job_id,
			user_id: this.userId,
			instructions: payload.optimizedPrompt,
			original_query: payload.originalPrompt,
			enhancement_options: JSON.stringify(payload.optimizerMeta ?? {}),
			status: response.status,
			progress: 0,
			created_at: response.created_at || now,
			updated_at: now,
		});

		this.insertEvent({
			id: this.generateId(),
			job_id: response.job_id,
			user_id: this.userId,
			type: "job_submitted",
			phase: "submit",
			step: null,
			message: "Research job submitted",
			details: JSON.stringify({ priority: response.priority }),
			progress: 0,
			section_id: null,
			section_title: null,
			section_index: null,
			total_sections: null,
			created_at: now,
		});

		this.startPolling(response.job_id);
		return response.job_id;
	}

	startPolling(jobId: string): void {
		if (this.polls.has(jobId)) return;
		const timerId = window.setInterval(() => {
			void this.poll(jobId);
		}, this.pollIntervalMs);
		this.polls.set(jobId, timerId);
		void this.poll(jobId);
	}

	stopPolling(jobId: string): void {
		const timerId = this.polls.get(jobId);
		if (typeof timerId === "number") {
			window.clearInterval(timerId);
		}
		this.polls.delete(jobId);
	}

	private async poll(jobId: string): Promise<void> {
		try {
			const status = await this.client.getJobStatus(jobId);
			this.applyStatus(jobId, status);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.insertEvent({
				id: this.generateId(),
				job_id: jobId,
				user_id: this.userId,
				type: "status_error",
				phase: "poll",
				step: null,
				message: "Failed to fetch job status",
				details: JSON.stringify({ error: msg }),
				progress: null,
				section_id: null,
				section_title: null,
				section_index: null,
				total_sections: null,
				created_at: new Date().toISOString(),
			});
		}
	}

	private applyStatus(jobId: string, status: JobStatusResponse): void {
		const now = new Date().toISOString();
		const cached = this.cache.get(jobId) ?? {};
		const statusChanged = cached.status !== status.status;
		const progressChanged = cached.progress !== status.progress;
		this.cache.set(jobId, { status: status.status, progress: status.progress });

		const extracted = extractReportData(status.results);
		const updatedRow: Partial<ResearchJobRow> & Pick<ResearchJobRow, "job_id" | "user_id"> = {
			job_id: jobId,
			user_id: this.userId,
			status: status.status,
			progress: status.progress ?? null,
			results: safeJsonStringify(status.results),
			updated_at: now,
			started_at: status.started_at ?? null,
			completed_at: status.completed_at ?? null,
			exa_research_id: status.exa_task_id ?? extracted.exaResearchId ?? null,
			title: extracted.title,
			summary: extracted.summary,
			citation_count: extracted.citationCount,
			processed_markdown: extracted.markdown,
			sections: extracted.sectionsJson ?? "[]",
			enhanced_content: extracted.enhancedContentJson,
			current_section_index: extracted.currentSectionIndex,
			total_sections: extracted.totalSections,
		};

		this.repo.upsertJob(updatedRow);

		if (statusChanged || progressChanged) {
			this.insertEvent({
				id: this.generateId(),
				job_id: jobId,
				user_id: this.userId,
				type: "job_progress",
				phase: "poll",
				step: null,
				message: `Status ${status.status}${typeof status.progress === "number" ? ` (${status.progress}%)` : ""}`,
				details: safeJsonStringify({ status: status.status, progress: status.progress }),
				progress: typeof status.progress === "number" ? status.progress : null,
				section_id: null,
				section_title: null,
				section_index: null,
				total_sections: null,
				created_at: now,
			});
		}

		if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") {
			this.stopPolling(jobId);
		}

		if (status.status === "completed") {
			void this.maybeWriteReport(jobId, extracted);
		}
	}

	private async maybeWriteReport(jobId: string, data: ExtractedReportData): Promise<void> {
		const job = this.repo.getJob(jobId);
		if (!job) return;
		if (job.report_note_path) return;
		if (!data.markdown?.trim()) {
			new Notice("Research completed, but no markdown was returned.");
			return;
		}

		const note = await this.noteWriter.writeReport({
			title: data.title || "Research report",
			summary: data.summary,
			markdown: data.markdown,
			originalPrompt: job.original_query,
			optimizedPrompt: job.instructions,
			includePromptSection: this.includePromptSection,
			folder: this.outputFolder,
		});

		this.repo.upsertJob({
			job_id: jobId,
			user_id: this.userId,
			report_note_path: note.path,
			updated_at: new Date().toISOString(),
		});
	}

	private insertEvent(event: ResearchEventRow): void {
		this.repo.insertEvent(event);
	}

	private generateId(): string {
		if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
			return crypto.randomUUID();
		}
		return `evt_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
	}
}

type ExtractedReportData = {
	title: string | null;
	summary: string | null;
	markdown: string | null;
	citationCount: number | null;
	sectionsJson: string | null;
	enhancedContentJson: string | null;
	currentSectionIndex: number | null;
	totalSections: number | null;
	exaResearchId: string | null;
};

function extractReportData(results: any): ExtractedReportData {
	const data = normalizeResults(results);
	const report =
		data?.final_report ||
		data?.finalReport ||
		data?.report ||
		data?.final ||
		data?.result ||
		data;

	const markdown =
		report?.processed_markdown ||
		report?.processedMarkdown ||
		report?.markdown ||
		report?.content ||
		report?.report;

	const title = report?.title || data?.title || null;
	const summary = report?.summary || data?.summary || null;
	const citationCount =
		report?.citation_count ||
		report?.citationCount ||
		(Array.isArray(report?.citations) ? report.citations.length : null);

	const sections = report?.sections || data?.sections;
	const enhancedContent = data?.enhanced_content || data?.enhancedContent || null;

	return {
		title: typeof title === "string" ? title : null,
		summary: typeof summary === "string" ? summary : null,
		markdown: typeof markdown === "string" ? markdown : null,
		citationCount: typeof citationCount === "number" ? citationCount : null,
		sectionsJson: Array.isArray(sections) ? safeJsonStringify(sections) : null,
		enhancedContentJson: enhancedContent ? safeJsonStringify(enhancedContent) : null,
		currentSectionIndex: typeof data?.current_section_index === "number" ? data.current_section_index : null,
		totalSections: typeof data?.total_sections === "number" ? data.total_sections : null,
		exaResearchId: typeof data?.researchId === "string" ? data.researchId : null,
	};
}

function normalizeResults(results: any): any {
	if (!results) return null;
	if (typeof results === "string") {
		try {
			return JSON.parse(results);
		} catch {
			return { markdown: results };
		}
	}
	return results;
}

function safeJsonStringify(value: any): string | null {
	if (value === undefined) return null;
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}
