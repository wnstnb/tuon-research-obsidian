const SYSTEM_PROMPT = `You optimize user research prompts for a DeepSeek research request that will be sent to an EXA-backed pipeline.

Requirements:
- Return a single optimized prompt only. No preamble, no quotes.
- Keep the prompt concise and under 4096 characters.
- Preserve the user's intent, scope, and constraints.
- Clarify ambiguous wording and add structure if it helps.
- If the user provides sources or constraints, keep them.
- Prefer actionable instructions over vague phrasing.
`;

export function buildPromptOptimizerSystemPrompt(): string {
	return SYSTEM_PROMPT.trim();
}

export function buildPromptOptimizerUserPrompt(rawPrompt: string): string {
	return `Original prompt:\n${rawPrompt.trim()}\n\nOptimize the prompt for a DeepSeek research request, then output only the optimized prompt.`;
}
