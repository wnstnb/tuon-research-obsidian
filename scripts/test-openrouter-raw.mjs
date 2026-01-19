const DEFAULT_PROMPT =
  "Breakdown what is happening with the stock market and a prediction for the next 12 monthts";

const prompt = process.argv.slice(2).join(" ").trim() || DEFAULT_PROMPT;
const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
const model = (process.env.OPENROUTER_MODEL || "openai/gpt-5-mini").trim();
const referer = (process.env.OPENROUTER_REFERER || "").trim();
const appTitle = (process.env.OPENROUTER_APP_TITLE || "Tuon Deep Research").trim();

if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY. Set it before running this script.");
  process.exit(1);
}

const systemPrompt = `You will be given a research task by a user. Your job is to produce a set of instructions for a researcher who will carry out the task.
 
 !IMPORTANT: Your final response must be less than or equal to 4096 characters, WHICH INCLUDES WHITESPACE AND ANY SPECIAL CHARACTERS. This rule must be followed. Drop fluff and make it concise.

GUIDELINES:

**Be Succinct and Maximize Specificity and Detail**
   - Include all known user preferences and explicitly list key attributes or dimensions to consider.
   - It is of utmost importance that all details from the user are included in the instructions.
   - Be concise and to the point to make sure the researcher can understand quickly the task.

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

const clarificationsSection =
  "\nNo additional clarifications provided - optimize based on the original request only.";

const userPrompt = `Original research request: "${prompt}"${clarificationsSection}

Transform this into comprehensive research instructions that:
1. Enhance the original request with clear specifications
2. Fill in essential dimensions that weren't specified as open-ended guidance
3. Use first-person perspective ("I need", "I want")
4. Specify output format (tables, structured reports, etc.) in markdown if beneficial
5. Include any relevant source preferences or constraints
6. Maintain the user's original intent while adding clarity and completeness

Return ONLY the optimized research instructions in markdown. Do not include JSON formatting or additional commentary.`;

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};
if (referer) headers["HTTP-Referer"] = referer;
if (appTitle) headers["X-Title"] = appTitle;

const MAX_FINAL_CHARS = 4096;

const body = {
  model,
  input: [
    { type: "message", role: "system", content: systemPrompt },
    { type: "message", role: "user", content: userPrompt },
  ],
  temperature: 0.1,
//   max_output_tokens: 4000,
  reasoning: { effort: "high" },
};

const response = await fetch("https://openrouter.ai/api/v1/responses", {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

const rawText = await response.text();
console.log(`Status: ${response.status} ${response.statusText}`);
console.log("Raw response:");
console.log(rawText);

try {
  const json = JSON.parse(rawText);
  console.log("\nParsed JSON:");
  console.log(JSON.stringify(json, null, 2));

  const outputItems = json?.output ?? [];
  const extracted = outputItems
    .flatMap((item) => {
      if (item?.type && item.type !== "message") return [];
      const content = Array.isArray(item?.content) ? item.content : [];
      return content
        .filter((part) => part?.type === "output_text" && typeof part?.text === "string")
        .map((part) => part.text);
    })
    .join("")
    .trim();

  const normalized = normalizeHarmonyOutput(extracted);

  if (!normalized) {
    console.log("\nNo extracted content text found.");
  } else {
    console.log("\nExtracted content length:", normalized.length);
    if (normalized.length <= MAX_FINAL_CHARS) {
      console.log("\nFinal output (no distillation needed):");
      console.log(normalized);
    } else {
      console.log(`\nOver ${MAX_FINAL_CHARS} chars → running helper distillation pass...`);
      try {
        const distilled = await distillToMaxChars({
          text: normalized,
          maxChars: MAX_FINAL_CHARS,
          apiKey,
          referer,
          appTitle,
        });

        console.log("\nDistilled length:", distilled.length);
        console.log("\nFinal distilled output:");
        console.log(distilled);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("\nHelper distillation FAILED:");
        console.error(msg);
        process.exitCode = 1;
      }
    }
  }
} catch {
  // Raw output already printed above.
}

async function distillToMaxChars({ text, maxChars, apiKey, referer, appTitle }) {
  const helperSystem = `You are a concise editor. Rewrite the input so that it preserves all substantive requirements, constraints, and details, but is shorter and clearer.

Hard constraints:
- Output must be valid markdown.
- Output must be <= ${maxChars} characters, including whitespace and punctuation.
- Do NOT add placeholders like "...", "[content abbreviated]", or similar.
- Do NOT add new requirements not present in the input.
- If you must drop something, drop the least important fluff first, not key constraints.

Return ONLY the rewritten markdown.`;

  const helperUser = `Rewrite this to be <= ${maxChars} characters:\n\n${text}`;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (referer) headers["HTTP-Referer"] = referer;
  if (appTitle) headers["X-Title"] = appTitle;

  const helperBody = {
    model: "openai/gpt-oss-120b",
    input: [
      { type: "message", role: "system", content: helperSystem },
      { type: "message", role: "user", content: helperUser },
    ],
    temperature: 0.1,
    max_output_tokens: 1000,
    reasoning: { effort: "none", exclude: true },
  };

  console.log("\n[helper] POST /responses", {
    model: helperBody.model,
    max_output_tokens: helperBody.max_output_tokens,
    reasoning: helperBody.reasoning,
  });

  const controller = new AbortController();
  const timeoutMs = 90000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetch("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify(helperBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }

  const raw = await resp.text();
  console.log(`[helper] status: ${resp.status} ${resp.statusText}`);
  console.log(`[helper] raw length: ${raw.length}`);
  if (!resp.ok) {
    throw new Error(`Helper distillation failed (${resp.status} ${resp.statusText}): ${raw.slice(0, 500)}`);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Helper distillation returned non-JSON: ${raw.slice(0, 500)}`);
  }

  const outputItems = json?.output ?? [];
  const extracted = outputItems
    .flatMap((item) => {
      if (item?.type && item.type !== "message") return [];
      const content = Array.isArray(item?.content) ? item.content : [];
      return content
        .filter((part) => part?.type === "output_text" && typeof part?.text === "string")
        .map((part) => part.text);
    })
    .join("")
    .trim();

  const normalized = normalizeHarmonyOutput(extracted);
  if (!normalized) {
    throw new Error("Helper distillation returned empty output_text.");
  }

  if (normalized.length > maxChars) {
    // Fail loudly so we can tune prompts/limits rather than silently truncating.
    throw new Error(
      `Helper distillation still too long (${normalized.length} chars > ${maxChars}). Increase strictness or add another pass.`
    );
  }

  return normalized;
}

function normalizeHarmonyOutput(text) {
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

