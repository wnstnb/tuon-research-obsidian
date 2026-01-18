import { requestUrl } from "obsidian";

export type EnhancedSubmitRequest = {
	instructions: string;
	schema?: Record<string, any> | null;
	model?: string;
	tagged_documents?: Array<Record<string, any>>;
	priority?: "low" | "normal" | "high" | "urgent";
	max_retries?: number;
	enhancement_config?: Record<string, any> | null;
};

export type EnhancedSubmitResponse = {
	success: boolean;
	job_id: string;
	status: string;
	priority: string;
	message: string;
	created_at: string;
	estimated_duration?: number;
};

export type JobStatusResponse = {
	success: boolean;
	job_id: string;
	status: string;
	progress: number;
	priority: string;
	created_at?: string;
	started_at?: string;
	completed_at?: string;
	error?: string;
	results?: any;
	retry_count?: number;
	max_retries?: number;
	exa_task_id?: string;
	enhanced?: boolean;
};

export class DeepResearchClient {
	constructor(private baseUrl: string, private apiKey?: string) {}

	updateConfig(baseUrl: string, apiKey?: string) {
		this.baseUrl = baseUrl;
		this.apiKey = apiKey;
	}

	async submitEnhancedJob(payload: EnhancedSubmitRequest): Promise<EnhancedSubmitResponse> {
		const response = await requestUrl({
			url: `${this.baseUrl.replace(/\/$/, "")}/api/research/enhanced-submit`,
			method: "POST",
			headers: this.buildHeaders(),
			contentType: "application/json",
			body: JSON.stringify(payload),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			const body = response.text?.trim() || JSON.stringify(response.json ?? {});
			throw new Error(`Deep Research submit failed (status=${response.status}). ${body}`);
		}
		return response.json as EnhancedSubmitResponse;
	}

	async getJobStatus(jobId: string): Promise<JobStatusResponse> {
		const response = await requestUrl({
			url: `${this.baseUrl.replace(/\/$/, "")}/api/research/status/${encodeURIComponent(jobId)}`,
			method: "GET",
			headers: this.buildHeaders(),
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			const body = response.text?.trim() || JSON.stringify(response.json ?? {});
			throw new Error(`Deep Research status failed (status=${response.status}). ${body}`);
		}
		return response.json as JobStatusResponse;
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {};
		if (this.apiKey?.trim()) {
			headers.Authorization = `Bearer ${this.apiKey.trim()}`;
		}
		return headers;
	}
}
