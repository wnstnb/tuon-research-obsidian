import { SqliteService } from "./sqliteService";

export type ResearchJobRow = {
	job_id: string;
	user_id: string;
	instructions: string;
	status: string;
	progress: number | null;
	results: string | null;
	async_server_job_id: string | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	title: string | null;
	summary: string | null;
	citation_count: number | null;
	processed_markdown: string | null;
	original_query: string | null;
	sections: string;
	research_type: string;
	response_id: string | null;
	webhook_data: string | null;
	parent_id: string | null;
	job_type: string;
	subtopic: string | null;
	order_index: number | null;
	estimated_tokens: number | null;
	actual_tokens: number | null;
	started_at: string | null;
	tagged_documents: string | null;
	enhancement_options: string | null;
	running_context: string | null;
	enhanced_sections: string | null;
	section_metadata: string | null;
	enhancement_status: string | null;
	current_section_index: number | null;
	total_sections: number | null;
	enhanced_content: string | null;
	exa_research_id: string | null;
	report_note_path: string | null;
};

export type ResearchEventRow = {
	id: string;
	job_id: string;
	user_id: string;
	type: string;
	phase: string;
	step: string | null;
	message: string;
	details: string | null;
	progress: number | null;
	section_id: string | null;
	section_title: string | null;
	section_index: number | null;
	total_sections: number | null;
	created_at: string;
};

export class ResearchRepo {
	constructor(private db: SqliteService) {}

	upsertJob(row: Partial<ResearchJobRow> & Pick<ResearchJobRow, "job_id" | "user_id">): void {
		const now = new Date().toISOString();
		const existing = this.getJob(row.job_id);
		const values: ResearchJobRow = {
			job_id: row.job_id,
			user_id: row.user_id ?? existing?.user_id ?? "",
			instructions: row.instructions ?? existing?.instructions ?? "",
			status: row.status ?? existing?.status ?? "pending",
			progress: row.progress ?? existing?.progress ?? null,
			results: row.results ?? existing?.results ?? null,
			async_server_job_id: row.async_server_job_id ?? existing?.async_server_job_id ?? null,
			created_at: row.created_at ?? existing?.created_at ?? now,
			updated_at: row.updated_at ?? existing?.updated_at ?? now,
			completed_at: row.completed_at ?? existing?.completed_at ?? null,
			title: row.title ?? existing?.title ?? null,
			summary: row.summary ?? existing?.summary ?? null,
			citation_count: row.citation_count ?? existing?.citation_count ?? null,
			processed_markdown: row.processed_markdown ?? existing?.processed_markdown ?? null,
			original_query: row.original_query ?? existing?.original_query ?? null,
			sections: row.sections ?? existing?.sections ?? "[]",
			research_type: row.research_type ?? existing?.research_type ?? "exa",
			response_id: row.response_id ?? existing?.response_id ?? null,
			webhook_data: row.webhook_data ?? existing?.webhook_data ?? null,
			parent_id: row.parent_id ?? existing?.parent_id ?? null,
			job_type: row.job_type ?? existing?.job_type ?? "root",
			subtopic: row.subtopic ?? existing?.subtopic ?? null,
			order_index: row.order_index ?? existing?.order_index ?? null,
			estimated_tokens: row.estimated_tokens ?? existing?.estimated_tokens ?? null,
			actual_tokens: row.actual_tokens ?? existing?.actual_tokens ?? null,
			started_at: row.started_at ?? existing?.started_at ?? null,
			tagged_documents: row.tagged_documents ?? existing?.tagged_documents ?? null,
			enhancement_options: row.enhancement_options ?? existing?.enhancement_options ?? null,
			running_context: row.running_context ?? existing?.running_context ?? null,
			enhanced_sections: row.enhanced_sections ?? existing?.enhanced_sections ?? null,
			section_metadata: row.section_metadata ?? existing?.section_metadata ?? null,
			enhancement_status: row.enhancement_status ?? existing?.enhancement_status ?? null,
			current_section_index: row.current_section_index ?? existing?.current_section_index ?? null,
			total_sections: row.total_sections ?? existing?.total_sections ?? null,
			enhanced_content: row.enhanced_content ?? existing?.enhanced_content ?? null,
			exa_research_id: row.exa_research_id ?? existing?.exa_research_id ?? null,
			report_note_path: row.report_note_path ?? existing?.report_note_path ?? null,
		};

		this.db.run(
			`INSERT INTO research_jobs (
				job_id, user_id, instructions, status, progress, results, async_server_job_id,
				created_at, updated_at, completed_at, title, summary, citation_count,
				processed_markdown, original_query, sections, research_type, response_id,
				webhook_data, parent_id, job_type, subtopic, order_index, estimated_tokens,
				actual_tokens, started_at, tagged_documents, enhancement_options,
				running_context, enhanced_sections, section_metadata, enhancement_status,
				current_section_index, total_sections, enhanced_content, exa_research_id,
				report_note_path
			) VALUES (
				?, ?, ?, ?, ?, ?, ?,
				?, ?, ?, ?, ?, ?,
				?, ?, ?, ?, ?,
				?, ?, ?, ?, ?, ?,
				?, ?, ?, ?,
				?, ?, ?, ?,
				?, ?, ?, ?,
				?
			)
			ON CONFLICT(job_id) DO UPDATE SET
				user_id=excluded.user_id,
				instructions=excluded.instructions,
				status=excluded.status,
				progress=excluded.progress,
				results=excluded.results,
				async_server_job_id=excluded.async_server_job_id,
				updated_at=excluded.updated_at,
				completed_at=excluded.completed_at,
				title=excluded.title,
				summary=excluded.summary,
				citation_count=excluded.citation_count,
				processed_markdown=excluded.processed_markdown,
				original_query=excluded.original_query,
				sections=excluded.sections,
				research_type=excluded.research_type,
				response_id=excluded.response_id,
				webhook_data=excluded.webhook_data,
				parent_id=excluded.parent_id,
				job_type=excluded.job_type,
				subtopic=excluded.subtopic,
				order_index=excluded.order_index,
				estimated_tokens=excluded.estimated_tokens,
				actual_tokens=excluded.actual_tokens,
				started_at=excluded.started_at,
				tagged_documents=excluded.tagged_documents,
				enhancement_options=excluded.enhancement_options,
				running_context=excluded.running_context,
				enhanced_sections=excluded.enhanced_sections,
				section_metadata=excluded.section_metadata,
				enhancement_status=excluded.enhancement_status,
				current_section_index=excluded.current_section_index,
				total_sections=excluded.total_sections,
				enhanced_content=excluded.enhanced_content,
				exa_research_id=excluded.exa_research_id,
				report_note_path=excluded.report_note_path
			;`,
			[
				values.job_id,
				values.user_id,
				values.instructions,
				values.status,
				values.progress,
				values.results,
				values.async_server_job_id,
				values.created_at,
				values.updated_at,
				values.completed_at,
				values.title,
				values.summary,
				values.citation_count,
				values.processed_markdown,
				values.original_query,
				values.sections,
				values.research_type,
				values.response_id,
				values.webhook_data,
				values.parent_id,
				values.job_type,
				values.subtopic,
				values.order_index,
				values.estimated_tokens,
				values.actual_tokens,
				values.started_at,
				values.tagged_documents,
				values.enhancement_options,
				values.running_context,
				values.enhanced_sections,
				values.section_metadata,
				values.enhancement_status,
				values.current_section_index,
				values.total_sections,
				values.enhanced_content,
				values.exa_research_id,
				values.report_note_path,
			]
		);
	}

	insertEvent(event: ResearchEventRow): void {
		this.db.run(
			`INSERT OR IGNORE INTO research_job_events (
				id, job_id, user_id, type, phase, step, message, details, progress,
				section_id, section_title, section_index, total_sections, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
			[
				event.id,
				event.job_id,
				event.user_id,
				event.type,
				event.phase,
				event.step,
				event.message,
				event.details,
				event.progress,
				event.section_id,
				event.section_title,
				event.section_index,
				event.total_sections,
				event.created_at,
			]
		);
	}

	listJobs(limit = 50): ResearchJobRow[] {
		return this.db.all<ResearchJobRow>(
			`SELECT * FROM research_jobs ORDER BY created_at DESC LIMIT ?;`,
			[limit]
		);
	}

	getJob(jobId: string): ResearchJobRow | null {
		return this.db.get<ResearchJobRow>(`SELECT * FROM research_jobs WHERE job_id = ?;`, [jobId]);
	}

	listEvents(jobId: string, limit = 200): ResearchEventRow[] {
		return this.db.all<ResearchEventRow>(
			`SELECT * FROM research_job_events WHERE job_id = ? ORDER BY created_at DESC LIMIT ?;`,
			[jobId, limit]
		);
	}
}
