import { Notice, requestUrl } from "obsidian";

export function normalizeApiKey(raw: string): string {
	const v = (raw ?? "").trim();
	return v.replace(/^(bearer|token)\s+/i, "").trim();
}

export function maskKeyForDisplay(raw: string): string {
	const v = normalizeApiKey(raw);
	if (!v) return "<empty>";
	if (v.length <= 8) return `${v.slice(0, 2)}…${v.slice(-2)}`;
	return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export async function testOpenRouterApiKey(opts: {
	apiKey: string;
	model: string;
	referer?: string;
	appTitle?: string;
}): Promise<{ ok: boolean; message: string }> {
	const key = normalizeApiKey(opts.apiKey);
	if (!key) return { ok: false, message: "Missing OpenRouter API key." };
	if (!opts.model?.trim()) return { ok: false, message: "Missing OpenRouter model." };

	const headers: Record<string, string> = {
		Authorization: `Bearer ${key}`,
		"Content-Type": "application/json",
	};
	if (opts.referer?.trim()) headers["HTTP-Referer"] = opts.referer.trim();
	if (opts.appTitle?.trim()) headers["X-Title"] = opts.appTitle.trim();

	try {
		let modelIds: string[] | null = null;
		try {
			const modelsRes = await requestUrl({
				url: "https://openrouter.ai/api/v1/models",
				method: "GET",
				headers: { Authorization: `Bearer ${key}` },
				throw: false,
			});
			if (modelsRes.status < 200 || modelsRes.status >= 300) {
				const bodyPreview =
					typeof modelsRes.text === "string" && modelsRes.text.trim()
						? modelsRes.text.trim().slice(0, 300)
						: JSON.stringify(modelsRes.json ?? {}).slice(0, 300);
				return {
					ok: false,
					message: `OpenRouter /models failed (status=${modelsRes.status}). ${bodyPreview}`,
				};
			}
			if (Array.isArray((modelsRes.json as any)?.data)) {
				modelIds = (modelsRes.json as any).data
					.map((m: any) => m?.id)
					.filter((id: any) => typeof id === "string");
			}
			if (modelIds?.length) {
				const model = opts.model.trim();
				if (!modelIds.includes(model)) {
					const sample = modelIds.slice(0, 5).join(", ");
					return {
						ok: false,
						message: `OpenRouter model not found: "${model}". Example models: ${sample}`,
					};
				}
			}
		} catch (e) {
			return {
				ok: false,
				message: `OpenRouter /models failed. ${formatRequestUrlError(e)}`,
			};
		}

		const r = await requestUrl({
			url: "https://openrouter.ai/api/v1/chat/completions",
			method: "POST",
			headers,
			contentType: "application/json",
			body: JSON.stringify({
				model: opts.model.trim(),
				messages: [
					{ role: "system", content: "Reply with the single word: OK" },
					{ role: "user", content: "ping" },
				],
				stream: false,
				temperature: 0,
			}),
			throw: false,
		});

		if (r.status < 200 || r.status >= 300) {
			const bodyPreview =
				typeof r.text === "string" && r.text.trim()
					? r.text.trim().slice(0, 300)
					: JSON.stringify(r.json ?? {}).slice(0, 300);
			return {
				ok: false,
				message: `OpenRouter /chat/completions failed (model=${opts.model.trim()}, status=${r.status}). ${bodyPreview}`,
			};
		}

		const text = (r.json as any)?.choices?.[0]?.message?.content;
		if (typeof text === "string" && text.toLowerCase().includes("ok")) {
			return {
				ok: true,
				message: `OpenRouter OK (model=${opts.model.trim()}, key=${maskKeyForDisplay(key)})`,
			};
		}

		const errMsg =
			(r.json as any)?.error?.message ||
			(r.json as any)?.message ||
			(r.json as any)?.error ||
			"";
		const bodyPreview = errMsg
			? String(errMsg).slice(0, 240)
			: JSON.stringify(r.json ?? {}).slice(0, 240);
		return {
			ok: false,
			message: `OpenRouter test failed (status=${r.status}). ${bodyPreview}`,
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, message: `OpenRouter request failed: ${msg}` };
	}
}

export function showTestResultToast(result: { ok: boolean; message: string }) {
	new Notice(result.message);
}

function formatRequestUrlError(e: unknown): string {
	const anyErr = e as any;
	const status = anyErr?.status ?? anyErr?.response?.status;
	const body = anyErr?.text ?? anyErr?.responseText ?? anyErr?.response?.text;
	const message = anyErr?.message ? String(anyErr.message) : String(e);
	return status ? `${message} (status=${status}, body=${body ?? ""})` : message;
}
