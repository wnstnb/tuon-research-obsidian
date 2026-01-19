export interface OpenRouterChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface OpenRouterChatCompletionRequest {
	model: string;
	messages: OpenRouterChatMessage[];
	temperature?: number;
	max_output_tokens?: number;
	reasoning?: OpenRouterResponsesRequest["reasoning"];
}

export interface OpenRouterResponsesRequest {
	model: string;
	input: Array<{
		type: "message";
		role: "system" | "user" | "assistant" | "developer";
		content: string;
	}>;
	temperature?: number;
	max_output_tokens?: number;
	reasoning?: {
		effort?: "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
		exclude?: boolean;
		enabled?: boolean;
	};
	tools?: Array<{ type: string }>;
	tool_choice?: "auto" | "required" | "none";
}

export interface OpenRouterResponsesResponse {
	output?: Array<{
		type?: string;
		content?: Array<{ type?: string; text?: string }>;
		summary?: Array<{ type?: string; text?: string }>;
	}>;
	error?: {
		message?: string;
	};
}

import { normalizeApiKey } from "./openrouterDiagnostics";

export interface OpenRouterClientOptions {
	apiKey: string;
	/** OpenRouter model id, e.g. "openai/gpt-5-mini". */
	model: string;
	/** Optional attribution headers. */
	referer?: string;
	appTitle?: string;
}

export async function openRouterChatCompletion(
	opts: OpenRouterClientOptions,
	request: Omit<OpenRouterChatCompletionRequest, "model">
): Promise<string> {
	const apiKey = normalizeApiKey(opts.apiKey);
	if (!apiKey?.trim()) {
		throw new Error("Missing OpenRouter API key.");
	}
	if (!opts.model?.trim()) {
		throw new Error("Missing OpenRouter model.");
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};

	if (opts.referer?.trim()) headers["HTTP-Referer"] = opts.referer.trim();
	if (opts.appTitle?.trim()) headers["X-Title"] = opts.appTitle.trim();

	const body: OpenRouterResponsesRequest = {
		model: opts.model,
		input: request.messages.map((message) => ({
			type: "message",
			role: message.role,
			content: message.content,
		})),
		temperature: request.temperature,
		max_output_tokens: request.max_output_tokens,
		reasoning: request.reasoning ?? { effort: "high" },
	};
	const attempt = async (requestBody: OpenRouterResponsesRequest) => {
		const res = await fetch("https://openrouter.ai/api/v1/responses", {
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
		});

		let json: OpenRouterResponsesResponse | undefined;
		try {
			json = (await res.json()) as OpenRouterResponsesResponse;
		} catch {
			// ignore JSON parse errors; handle below
		}

		if (!res.ok) {
			const msg =
				json?.error?.message ||
				`OpenRouter request failed (${res.status} ${res.statusText})`;
			throw new Error(msg);
		}

		const outputText = extractOutputTextFromResponse(json);
		const text = outputText ? normalizeHarmonyOutput(outputText) : null;
		if (!text) {
			const errMsg = json?.error?.message;
			if (errMsg) {
				throw new Error(errMsg);
			}
			console.warn("OpenRouter returned empty content.", { response: json });
			return null;
		}

		return text.trim();
	};

	const first = await attempt(body);
	if (first) return first;

	// Retry once with a lower temperature to reduce flaky empty responses.
	const retryBody: OpenRouterResponsesRequest = {
		...body,
		temperature: 0,
	};
	const retry = await attempt(retryBody);
	if (retry) return retry;

	throw new Error("OpenRouter returned no text content.");
}

function extractOutputTextFromResponse(response?: OpenRouterResponsesResponse): string | null {
	const outputItems = response?.output ?? [];
	const pieces: string[] = [];

	for (const item of outputItems) {
		if (item?.type && item.type !== "message") continue;
		const content = Array.isArray(item?.content) ? item.content : [];
		for (const part of content) {
			if (part?.type === "output_text" && typeof part.text === "string") {
				pieces.push(part.text);
			}
		}
	}

	const combined = pieces.join("").trim();
	return combined ? combined : null;
}

function normalizeHarmonyOutput(text: string): string {
	const trimmed = text.trim();
	const lower = trimmed.toLowerCase();

	const finalTagStart = lower.indexOf("<final>");
	const finalTagEnd = lower.indexOf("</final>");
	if (finalTagStart !== -1 && finalTagEnd !== -1 && finalTagEnd > finalTagStart) {
		return trimmed.slice(finalTagStart + 7, finalTagEnd).trim();
	}

	const finalLineMatch = trimmed.match(/(?:^|\n)\s*final\s*[:\-]\s*/i);
	if (finalLineMatch && typeof finalLineMatch.index === "number") {
		const start = finalLineMatch.index + finalLineMatch[0].length;
		return trimmed.slice(start).trim();
	}

	const finalSectionMatch = trimmed.match(/(?:^|\n)\s*final\s*\n/i);
	if (finalSectionMatch && typeof finalSectionMatch.index === "number") {
		const start = finalSectionMatch.index + finalSectionMatch[0].length;
		return trimmed.slice(start).trim();
	}

	const analysisTagStart = lower.indexOf("<analysis>");
	const analysisTagEnd = lower.indexOf("</analysis>");
	if (analysisTagStart !== -1 && analysisTagEnd !== -1 && analysisTagEnd > analysisTagStart) {
		const withoutAnalysis =
			trimmed.slice(0, analysisTagStart) + trimmed.slice(analysisTagEnd + 11);
		return withoutAnalysis.trim();
	}

	return trimmed;
}

function extractContentText(content: unknown): string | null {
	if (!content) return null;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const combined = content
			.map((part) => {
				if (typeof part === "string") return part;
				if (part && typeof part === "object") {
					const maybeText = (part as { text?: unknown; content?: unknown; value?: unknown }).text;
					const maybeTextValue =
						maybeText && typeof maybeText === "object"
							? (maybeText as { value?: unknown; text?: unknown }).value ??
							  (maybeText as { value?: unknown; text?: unknown }).text
							: null;
					if (typeof maybeText === "string") return maybeText;
					if (typeof maybeTextValue === "string") return maybeTextValue;
					const maybeContent = (part as { content?: unknown }).content;
					if (typeof maybeContent === "string") return maybeContent;
				}
				return "";
			})
			.join("");
		return combined.trim() ? combined : null;
	}
	if (content && typeof content === "object") {
		const maybeText = (content as { text?: unknown }).text;
		if (typeof maybeText === "string") return maybeText;
		if (maybeText && typeof maybeText === "object") {
			const maybeValue = (maybeText as { value?: unknown; text?: unknown }).value;
			const maybeInnerText = (maybeText as { value?: unknown; text?: unknown }).text;
			if (typeof maybeValue === "string") return maybeValue;
			if (typeof maybeInnerText === "string") return maybeInnerText;
		}
		const maybeContent = (content as { content?: unknown }).content;
		if (typeof maybeContent === "string") return maybeContent;
		if (maybeContent && typeof maybeContent === "object") {
			const maybeValue = (maybeContent as { value?: unknown; text?: unknown }).value;
			const maybeInnerText = (maybeContent as { value?: unknown; text?: unknown }).text;
			if (typeof maybeValue === "string") return maybeValue;
			if (typeof maybeInnerText === "string") return maybeInnerText;
		}
	}
	return null;
}
