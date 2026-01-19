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
	eventCount?: number;
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

	resumeIncompleteJobs(limit = 50): number {
		const jobs = this.repo.listIncompleteJobs(limit);
		jobs.forEach((job) => {
			if (!this.isTerminalStatus(job.status)) {
				this.startPolling(job.job_id);
			}
		});
		return jobs.length;
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

		const normalizedResults = normalizeResults(status.results);
		const extracted = extractReportData(normalizedResults);
		const eventCount = this.ingestResultEvents(jobId, normalizedResults, now, cached.eventCount);
		this.cache.set(jobId, {
			status: status.status,
			progress: status.progress,
			eventCount,
		});
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

	private ingestResultEvents(
		jobId: string,
		normalizedResults: any,
		fallbackTimestamp: string,
		previousCount?: number
	): number | undefined {
		const rawEvents = extractEventPayloads(normalizedResults);
		if (!rawEvents.length) return previousCount;

		const startIndex =
			typeof previousCount === "number" && previousCount >= 0 && previousCount < rawEvents.length
				? previousCount
				: 0;
		const eventsToInsert = rawEvents.slice(startIndex);

		eventsToInsert.forEach((rawEvent, index) => {
			const normalized = normalizeEventPayload(rawEvent, fallbackTimestamp);
			if (!normalized) return;
			const row = buildEventRow({
				jobId,
				userId: this.userId,
				normalized,
				fallbackTimestamp,
				index: startIndex + index,
			});
			if (row) {
				this.insertEvent(row);
			}
		});

		return rawEvents.length;
	}

	private isTerminalStatus(status?: string | null): boolean {
		return ["completed", "failed", "cancelled"].includes((status || "").toLowerCase());
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

function extractReportData(data: any): ExtractedReportData {
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


type NormalizedEventPayload = {
	id?: string;
	type: string;
	phase: string;
	step?: string | null;
	message: string;
	details?: any;
	progress?: number | null;
	sectionId?: string | null;
	sectionTitle?: string | null;
	sectionIndex?: number | null;
	totalSections?: number | null;
	createdAt?: string | null;
};

function extractEventPayloads(results: any): any[] {
	if (!results) return [];
	if (Array.isArray(results)) return results;
	const candidates = [
		results?.events,
		results?.data?.events,
		results?.result?.events,
		results?.results?.events,
		results?.payload?.events,
		results?.final_report?.events,
		results?.finalReport?.events,
		results?.final?.events,
		results?.report?.events,
		results?.value?.events,
	];
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}

function normalizeEventPayload(raw: any, fallbackTimestamp: string): NormalizedEventPayload | null {
	if (!raw || typeof raw !== "object") return null;
	const sectionFields = extractSectionFields(raw);
	const createdAt = normalizeEventTimestamp(
		raw.createdAt ?? raw.created_at ?? raw.timestamp ?? raw.time,
		fallbackTimestamp
	);

	const hasNormalizedShape =
		typeof raw.type === "string" &&
		typeof raw.phase === "string" &&
		typeof raw.message === "string";
	if (hasNormalizedShape) {
		return {
			id: typeof raw.id === "string" ? raw.id : undefined,
			type: String(raw.type),
			phase: String(raw.phase),
			step: raw.step ? String(raw.step) : null,
			message: String(raw.message).slice(0, 500),
			details: raw.details ?? raw,
			progress: clampProgress(raw.progress),
			createdAt,
			...sectionFields,
		};
	}

	const eventType = String(
		raw.eventType || raw.event_type || raw.type || raw.event || raw.status || "event"
	);
	const { message, progress } = formatExaEventMessageAndProgress(raw, eventType);
	return {
		type: "exa_event",
		phase: "exa",
		step: eventType,
		message: message.slice(0, 500),
		details: raw,
		progress,
		createdAt,
		...sectionFields,
	};
}

function buildEventRow(args: {
	jobId: string;
	userId: string;
	normalized: NormalizedEventPayload;
	fallbackTimestamp: string;
	index: number;
}): ResearchEventRow | null {
	const { jobId, userId, normalized, fallbackTimestamp, index } = args;
	if (!normalized.message?.trim()) return null;
	const details = normalizeDetails(normalized.details);
	const createdAt = normalizeEventTimestamp(normalized.createdAt, fallbackTimestamp);
	const id =
		typeof normalized.id === "string" && normalized.id
			? normalized.id
			: buildEventId(jobId, normalized, createdAt, details, index);
	return {
		id,
		job_id: jobId,
		user_id: userId,
		type: normalized.type,
		phase: normalized.phase,
		step: normalized.step ?? null,
		message: normalized.message,
		details,
		progress: clampProgress(normalized.progress),
		section_id: normalized.sectionId ?? null,
		section_title: normalized.sectionTitle ?? null,
		section_index: normalized.sectionIndex ?? null,
		total_sections: normalized.totalSections ?? null,
		created_at: createdAt,
	};
}

function extractSectionFields(raw: any): {
	sectionId?: string | null;
	sectionTitle?: string | null;
	sectionIndex?: number | null;
	totalSections?: number | null;
} {
	const sectionId = raw.sectionId ?? raw.section_id ?? null;
	const sectionTitle = raw.sectionTitle ?? raw.section_title ?? null;
	const sectionIndex = raw.sectionIndex ?? raw.section_index ?? null;
	const totalSections = raw.totalSections ?? raw.total_sections ?? null;
	return {
		sectionId: sectionId != null ? String(sectionId) : null,
		sectionTitle: sectionTitle != null ? String(sectionTitle) : null,
		sectionIndex: typeof sectionIndex === "number" ? sectionIndex : null,
		totalSections: typeof totalSections === "number" ? totalSections : null,
	};
}

function normalizeDetails(details: any): string | null {
	if (details === undefined || details === null) return null;
	if (typeof details === "string") return details;
	return safeJsonStringify(details);
}

function normalizeEventTimestamp(value: any, fallback: string): string {
	if (!value) return fallback;
	if (typeof value === "string") return value;
	if (typeof value === "number") {
		const ms = value > 1_000_000_000_000 ? value : value * 1000;
		const date = new Date(ms);
		return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
	}
	return fallback;
}

function buildEventId(
	jobId: string,
	normalized: NormalizedEventPayload,
	createdAt: string,
	details: string | null,
	index: number
): string {
	const signature = [
		jobId,
		normalized.type,
		normalized.phase,
		normalized.step ?? "",
		normalized.message ?? "",
		createdAt,
		details ? hashString(details) : "",
		String(index),
	].join("|");
	return `evt_${hashString(signature)}`;
}

function formatExaEventMessageAndProgress(
	evt: Record<string, any>,
	eventType: string
): { message: string; progress: number | null } {
	const et = (eventType || "").toLowerCase();
	let progress: number | null = null;
	let message = eventType || "event";

	if (et === "plan-operation" || et === "task-operation") {
		const data = evt.data ?? {};
		if (data && typeof data === "object") {
			const opType = String(data.type || "").toLowerCase();
			if (opType === "search") {
				const query = String(data.query || "").trim();
				const goal = String(data.goal || "").trim();
				if (query && goal) {
					message = `Search: ${query} (${goal})`;
				} else if (query) {
					message = `Search: ${query}`;
				} else {
					message = "Search";
				}
				progress = et === "plan-operation" ? 25 : 70;
			} else if (opType === "crawl") {
				const result = data.result ?? {};
				const url = result && typeof result === "object" ? result.url : null;
				message = url ? `Crawl: ${url}` : "Crawl";
				progress = et === "plan-operation" ? 55 : 80;
			} else if (opType === "think") {
				message = "Thinking...";
				progress = et === "plan-operation" ? 10 : 65;
			} else {
				message = `${eventType}: ${data.type || "operation"}`;
				progress = et === "plan-operation" ? 15 : 65;
			}
		}
	} else if (et === "plan-output") {
		const output = evt.output ?? {};
		if (output && typeof output === "object") {
			const outputType = String(output.outputType || "").toLowerCase();
			if (outputType === "tasks") {
				const tasks = output.tasksInstructions ?? [];
				message = Array.isArray(tasks) ? `Planned ${tasks.length} tasks` : "Planned tasks";
				progress = 40;
			} else if (outputType === "stop") {
				message = "Plan decided to stop";
				progress = 40;
			} else {
				message = `Plan output: ${output.outputType || "output"}`;
				progress = 40;
			}
		}
	} else if (et === "task-definition") {
		const instructions = String(evt.instructions || "").trim();
		const taskId = String(evt.taskId || "").trim();
		if (instructions) {
			message = `Task created: ${instructions}`;
		} else if (taskId) {
			message = `Task created: ${taskId}`;
		} else {
			message = "Task created";
		}
		progress = 60;
	} else if (et === "task-output") {
		const taskId = String(evt.taskId || "").trim();
		message = taskId ? `Task completed: ${taskId}` : "Task completed";
		progress = 90;
	} else {
		const status = evt.status ?? evt.state;
		if (status) {
			message = String(status);
		}
	}

	const explicitProgress = evt.progress;
	const resolvedProgress = explicitProgress != null ? clampProgress(explicitProgress) : clampProgress(progress);
	return { message: String(message).slice(0, 500), progress: resolvedProgress };
}

function clampProgress(value: any): number | null {
	if (value === undefined || value === null) return null;
	const num = Number(value);
	if (!Number.isFinite(num)) return null;
	return Math.max(0, Math.min(100, Math.round(num)));
}

function hashString(value: string): string {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return (hash >>> 0).toString(16);
}
