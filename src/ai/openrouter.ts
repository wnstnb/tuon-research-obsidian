export interface OpenRouterChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface OpenRouterChatCompletionRequest {
	model: string;
	messages: OpenRouterChatMessage[];
	temperature?: number;
	max_tokens?: number;
}

export interface OpenRouterChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
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

	const body: OpenRouterChatCompletionRequest = {
		model: opts.model,
		messages: request.messages,
		temperature: request.temperature,
		max_tokens: request.max_tokens,
	};

	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});

	let json: OpenRouterChatCompletionResponse | undefined;
	try {
		json = (await res.json()) as OpenRouterChatCompletionResponse;
	} catch {
		// ignore JSON parse errors; handle below
	}

	if (!res.ok) {
		const msg =
			json?.error?.message ||
			`OpenRouter request failed (${res.status} ${res.statusText})`;
		throw new Error(msg);
	}

	const text = json?.choices?.[0]?.message?.content;
	if (!text || typeof text !== "string") {
		throw new Error("OpenRouter returned no text content.");
	}
	return text.trim();
}
