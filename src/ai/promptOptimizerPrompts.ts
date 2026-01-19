export type QuestionAnswer = {
	question: string;
	answer: string;
};

export type TaggedDocument = {
	id: string;
	title: string;
	content?: string;
};

const SYSTEM_PROMPT = `You will be given a research task by a user. Your job is to produce a set of instructions for a researcher who will carry out the task.

!IMPORTANT: Your final response must be less than or equal to 4000 characters. This rule must be followed. 

GUIDELINES:

**Maximize Specificity and Detail**
   - Include all known user preferences and explicitly list key attributes or dimensions to consider.
   - It is of utmost importance that all details from the user are included in the instructions.

**Fill in Unstated But Necessary Dimensions as Open-Ended**
   - If certain attributes are essential for a meaningful output but the user has not provided them, treat them as open questions and prompt for clarification.

**Avoid Unwarranted Assumptions**
   - If the user has not provided a particular detail, do not invent one.
   - Instead, state the lack of specification and guide the researcher to treat it as flexible or acceptable.

**Use the First Person**
   - Phrase the request from the perspective of the user.

**Sources**
   - If specific sources should be prioritized, specify them in the prompt.

**Output Format Constraints**
   - The final research report produced from these instructions must be in markdown.
   - Avoid requesting deliverables that cannot be produced in Obsidian (e.g., PowerPoints, PDFs, images, or charts that require external rendering).

**Document Usage Patterns**
   - When tagged documents are provided, analyze the user's intent and instructions carefully with respect to the document(s)
   - **Template/Format Requests**: If user mentions "format", "template", "similar", "recreate", or "based on", use the document as a structural template
   - **Reference Requests**: If user mentions "reference", "look at", or "from my document", extract and incorporate specific content
   - **General Context**: For other cases, use documents as background context to inform research direction

Focus on creating clear, comprehensive research instructions that properly utilize any tagged documents according to the user's intent.

Format the response using markdown.`;

export function buildPromptOptimizerSystemPrompt(): string {
	return SYSTEM_PROMPT.trim();
}

export function buildPromptOptimizerUserPrompt(input: {
	originalPrompt: string;
	questionsAndAnswers?: QuestionAnswer[];
	taggedDocuments?: TaggedDocument[];
}): string {
	const originalPrompt = input.originalPrompt.trim();
	const questionsAndAnswers = input.questionsAndAnswers ?? [];
	const taggedDocuments = input.taggedDocuments ?? [];

	let documentContext = "";
	let documentUsageInstructions = "";

	if (taggedDocuments.length > 0) {
		const researchText = originalPrompt.toLowerCase();
		const hasFormatKeywords =
			researchText.includes("format") ||
			researchText.includes("template") ||
			researchText.includes("similar") ||
			researchText.includes("recreate") ||
			researchText.includes("based on");
		const hasReferenceKeywords =
			researchText.includes("reference") ||
			researchText.includes("look at") ||
			researchText.includes("from my document") ||
			researchText.includes("in my document");

		const isFormatRequest = hasFormatKeywords && !hasReferenceKeywords;
		const isReferenceRequest = hasReferenceKeywords || (!hasFormatKeywords && taggedDocuments.length > 0);
		const documentTitles = taggedDocuments.map((doc) => doc.title).join(", ");

		if (isFormatRequest) {
			documentContext = `\n\nTEMPLATE DOCUMENT(S): ${documentTitles}`;
			documentUsageInstructions = `
**TEMPLATE/FORMAT USAGE:**
- Analyze the structure, style, and format of the tagged document(s)
- Use the document(s) as a template for organizing and presenting the research
- Maintain similar sections, headings, and overall structure
- Adapt the format to fit the new research topic while preserving the effective organizational approach
- If multiple documents are tagged, identify the best format elements from each`;
		} else if (isReferenceRequest) {
			documentContext = `\n\nREFERENCE DOCUMENT(S): ${documentTitles}`;
			documentUsageInstructions = `
**REFERENCE CONTEXT USAGE:**
- Extract relevant information, facts, or context from the tagged document(s)
- Use the document content to inform and enhance the research approach
- Identify key points, data, or insights that should be referenced or built upon
- Ensure the research incorporates or addresses content from the tagged documents
- If multiple documents are tagged, synthesize relevant information from all sources`;
		} else {
			documentContext = `\n\nCONTEXT DOCUMENT(S): ${documentTitles}`;
			documentUsageInstructions = `
**GENERAL CONTEXT USAGE:**
- Consider the tagged document(s) as background context for the research
- Use document content to inform research direction and scope
- Ensure research findings are relevant to the context provided by the documents`;
		}
	}

	const questionsText =
		questionsAndAnswers.length > 0
			? questionsAndAnswers.map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n")
			: "";

	const clarificationsSection = questionsText
		? `\nUser provided these clarifications:\n${questionsText}`
		: "\nNo additional clarifications provided - optimize based on the original request only.";

	return `Original research request: "${originalPrompt}"${clarificationsSection}${documentContext}${documentUsageInstructions}

Transform this into comprehensive research instructions that:
1. ${questionsText ? "Incorporate ALL user clarifications and preferences" : "Enhance the original request with clear specifications"}
2. Fill in essential dimensions that weren't specified as open-ended guidance
3. Use first-person perspective ("I need", "I want")
4. Specify output format (tables, structured reports, etc.) in markdown if beneficial
5. Include any relevant source preferences or constraints
6. Maintain the user's original intent while adding clarity and completeness
7. ${taggedDocuments.length > 0 ? "Provide specific guidance on how to use the tagged document(s) according to the detected intent" : ""}
8. Ensure the final response is no more than 4000 characters long

Return ONLY the optimized research instructions in markdown. Do not include JSON formatting or additional commentary.`;
}
