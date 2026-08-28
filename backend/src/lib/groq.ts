import Groq from "groq-sdk";

let groq: Groq | null = null;

export function getGroq(): Groq | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  if (!groq) groq = new Groq({ apiKey: key });
  return groq;
}

// llama-3.3-70b-versatile is decommissioned on GroqCloud as of 2026-08-16;
// migrated to Groq's recommended replacement.
const MILESTONE_MODEL = "openai/gpt-oss-120b";
const COVER_LETTER_MODEL = "openai/gpt-oss-120b";
const REWRITE_MODEL = "openai/gpt-oss-120b";

export async function generateMilestoneSuggestions(input: {
  projectTitle: string;
  projectDescription: string;
  totalBudget: string;
  durationDays: string;
  userPrompt: string;
  milestoneIndex: number | null;
}): Promise<string[]> {
  const client = getGroq();
  if (!client) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const idx =
    input.milestoneIndex !== null
      ? input.milestoneIndex + 1
      : "new / unspecified";

  const system = `You are helping structure freelance escrow milestones on Stellar/Soroban.
Return ONLY valid JSON with this exact shape (no markdown):
{"suggestions":["string","string","string"]}
Each suggestion is one milestone DESCRIPTION only (deliverables, acceptance criteria, no token amounts).
Be concrete and professional. Three distinct options.`;

  const user = `Project title: ${input.projectTitle}
Project description: ${input.projectDescription}
Total budget (tokens, informational): ${input.totalBudget}
Duration (days): ${input.durationDays}
Milestone focus (user): ${input.userPrompt}
Milestone number context: ${idx}

Generate three milestone description options.`;

  const completion = await client.chat.completions.create({
    model: MILESTONE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.6,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  const parsed = JSON.parse(text) as { suggestions?: string[] };
  const list = parsed.suggestions;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("Invalid AI response shape");
  }
  return list
    .slice(0, 5)
    .map((s) => String(s).trim())
    .filter(Boolean);
}

export async function generateCoverLetter(input: {
  jobTitle: string;
  jobDescription: string;
  proposedTimelineDays?: string;
  tone?: string;
  userDraft?: string;
}): Promise<string> {
  const client = getGroq();
  if (!client) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const hasUserDraft = input.userDraft && input.userDraft.trim().length > 10;

  const system = hasUserDraft
    ? `You are a professional writing editor who improves cover letters for freelance job applications.
Return ONLY valid JSON: {"coverLetter":"..."}
Rules:
- Keep the applicant's core points, tone, personality, and specific claims intact
- Fix grammar, flow, and clarity
- Make it more compelling without inventing new facts or removing unique details
- Keep it 120–250 words, first person, no placeholders like [Your Name]
- Do NOT rewrite it completely — enhance what is already there`
    : `You write concise, professional cover letters for freelance job applications.
Return ONLY valid JSON: {"coverLetter":"..."}
The cover letter should be 120–220 words, first person, no placeholders like [Your Name].`;

  const user = hasUserDraft
    ? `Improve this cover letter draft while preserving the applicant's voice and specific points.

Job title: ${input.jobTitle}
Job / project description:
${input.jobDescription}
${input.proposedTimelineDays ? `Proposed timeline (days): ${input.proposedTimelineDays}` : ""}

Applicant's draft to improve:
"""
${input.userDraft}
"""`
    : `Job title: ${input.jobTitle}
Job / project description:
${input.jobDescription}
${input.proposedTimelineDays ? `Applicant proposed timeline (days): ${input.proposedTimelineDays}` : ""}
Tone: ${input.tone ?? "professional and confident"}`;

  const completion = await client.chat.completions.create({
    model: COVER_LETTER_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  const parsed = JSON.parse(text) as { coverLetter?: string };
  const letter = parsed.coverLetter?.trim();
  if (!letter) {
    throw new Error("Invalid AI response shape");
  }
  return letter;
}

export async function rewriteProjectDescription(input: {
  text: string;
}): Promise<string> {
  const client = getGroq();
  if (!client) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const system = `You improve grammar, clarity, and professionalism for a project description.\nReturn ONLY valid JSON: {\"text\":\"...\"}\nRules:\n- Keep meaning and requirements intact\n- Keep roughly similar length (do not expand more than ~20%)\n- Do not add new features not mentioned\n- No markdown`;

  const user = `Rewrite this project description:\n\n${input.text}`;

  const completion = await client.chat.completions.create({
    model: REWRITE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? "";
  const parsed = JSON.parse(text) as { text?: string };
  const rewritten = parsed.text?.trim();
  if (!rewritten) {
    throw new Error("Invalid AI response shape");
  }
  return rewritten;
}
