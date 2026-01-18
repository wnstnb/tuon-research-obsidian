import { openRouterChatCompletion } from "./openrouter";
import {
	buildPromptOptimizerSystemPrompt,
	buildPromptOptimizerUserPrompt,
} from "./promptOptimizerPrompts";

export type PromptOptimizerOptions = {
	apiKey: string;
	model: string;
	referer?: string;
	appTitle?: string;
};

export async function optimizePrompt(
	opts: PromptOptimizerOptions,
	rawPrompt: string
): Promise<string> {
	const system = buildPromptOptimizerSystemPrompt();
	const user = buildPromptOptimizerUserPrompt(rawPrompt);
	return openRouterChatCompletion(
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
			max_tokens: 800,
		}
	);
}
