import { openRouterChatCompletion } from "./openrouter";
import {
	buildPromptOptimizerSystemPrompt,
	buildPromptOptimizerUserPrompt,
	QuestionAnswer,
	TaggedDocument,
} from "./promptOptimizerPrompts";

export type PromptOptimizerOptions = {
	apiKey: string;
	model: string;
	referer?: string;
	appTitle?: string;
};

export type PromptOptimizerContext = {
	questionsAndAnswers?: QuestionAnswer[];
	taggedDocuments?: TaggedDocument[];
};

const MAX_OPTIMIZED_PROMPT_LENGTH = 4096;

export async function optimizePrompt(
	opts: PromptOptimizerOptions,
	rawPrompt: string,
	context: PromptOptimizerContext = {}
): Promise<string> {
	const system = buildPromptOptimizerSystemPrompt();
	const user = buildPromptOptimizerUserPrompt({
		originalPrompt: rawPrompt,
		questionsAndAnswers: context.questionsAndAnswers,
		taggedDocuments: context.taggedDocuments,
	});
	const optimized = await openRouterChatCompletion(
		{
			apiKey: opts.apiKey,
			model: opts.model,
			referer: opts.referer,
			appTitle: opts.appTitle,
		},
		{
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			temperature: 0.2,
		}
	);
	if (optimized.length <= MAX_OPTIMIZED_PROMPT_LENGTH) return optimized;

	// Second pass: distill without truncation/placeholders.
	return distillToMaxChars({
		text: optimized,
		maxChars: MAX_OPTIMIZED_PROMPT_LENGTH,
		apiKey: opts.apiKey,
		referer: opts.referer,
		appTitle: opts.appTitle,
	});
}

async function distillToMaxChars(args: {
	text: string;
	maxChars: number;
	apiKey: string;
	referer?: string;
	appTitle?: string;
}): Promise<string> {
	const helperSystem = `You are a concise editor. Rewrite the input so that it preserves all substantive requirements, constraints, and details, but is shorter and clearer.

Hard constraints:
- Output must be valid markdown.
- Output must be <= ${args.maxChars} characters, including whitespace and punctuation.
- Do NOT add placeholders like "...", "[content abbreviated]", or similar.
- Do NOT add new requirements not present in the input.
- If you must drop something, drop the least important fluff first, not key constraints.

Return ONLY the rewritten markdown.`;

	const helperUser = `Rewrite this to be <= ${args.maxChars} characters:\n\n${args.text}`;

	const distilled = await openRouterChatCompletion(
		{
			apiKey: args.apiKey,
			model: "openai/gpt-oss-120b",
			referer: args.referer,
			appTitle: args.appTitle,
		},
		{
			messages: [
				{ role: "system", content: helperSystem },
				{ role: "user", content: helperUser },
			],
			temperature: 0.1,
			max_output_tokens: 1000
		}
	);

	if (distilled.length > args.maxChars) {
		throw new Error(
			`Optimizer distillation still too long (${distilled.length} chars > ${args.maxChars}).`
		);
	}
	return distilled;
}
