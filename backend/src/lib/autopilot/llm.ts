/**
 * The model Autopilot thinks with.
 *
 * xAI's Grok when XAI_API_KEY is set, otherwise Groq (already configured for
 * the AI writers). Both speak the OpenAI chat-completions dialect, so one
 * fetch covers either and no extra SDK is needed.
 *
 * Every Autopilot call is extraction — a brief, a score, a verdict — and a
 * malformed answer decides whether somebody is hired or paid. So the answer is
 * forced to JSON, checked by the caller's validator, and on a bad shape the
 * model is shown its own mistake once and asked again.
 */

interface Provider {
  name: string;
  url: string;
  key: string;
  model: string;
}

function provider(): Provider | null {
  const xai = process.env.XAI_API_KEY?.trim();
  if (xai) {
    return {
      name: "grok",
      url: "https://api.x.ai/v1/chat/completions",
      key: xai,
      model: process.env.AUTOPILOT_MODEL?.trim() || "grok-4-fast",
    };
  }
  const groq = process.env.GROQ_API_KEY?.trim();
  if (groq) {
    return {
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: groq,
      model: process.env.AUTOPILOT_MODEL?.trim() || "openai/gpt-oss-120b",
    };
  }
  return null;
}

export function llmName(): string | null {
  const p = provider();
  return p ? `${p.name}:${p.model}` : null;
}

export class LlmRateLimited extends Error {}

async function complete(
  p: Provider,
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const res = await fetch(p.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: p.model,
      max_tokens: maxTokens,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 429) throw new LlmRateLimited(`${p.name} rate limited`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${p.name} ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${p.name} returned an empty answer`);
  return text;
}

/**
 * Ask for one JSON object. `validate` returns the typed value or throws with a
 * message the model can act on.
 */
export async function llmJson<T>(opts: {
  system: string;
  user: string;
  shape: string;
  validate: (raw: unknown) => T;
  maxTokens?: number;
  temperature?: number;
}): Promise<T> {
  const p = provider();
  if (!p)
    throw new Error(
      "No language model configured (XAI_API_KEY or GROQ_API_KEY)",
    );

  const system = `${opts.system}\n\nRespond with ONLY one JSON object, no markdown fences, no prose, in exactly this shape:\n${opts.shape}`;
  let correction = "";
  let lastErr: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await complete(
        p,
        system,
        correction ? `${opts.user}\n\n${correction}` : opts.user,
        opts.maxTokens ?? 2048,
        opts.temperature ?? 0.2,
      );
      let json: unknown;
      try {
        json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        throw new Error(`not valid JSON: ${raw.slice(0, 160)}`);
      }
      return opts.validate(json);
    } catch (err) {
      if (err instanceof LlmRateLimited) throw err;
      lastErr = err;
      correction = `Your previous answer was rejected: ${
        err instanceof Error ? err.message : String(err)
      }. Answer again in the exact shape required.`;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ─── Small validators, so no schema library is needed ────────────────────────

export function obj(raw: unknown, what: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${what} must be an object`);
  }
  return raw as Record<string, unknown>;
}

export function num(
  v: unknown,
  what: string,
  min: number,
  max: number,
): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`${what} must be a number`);
  }
  return Math.max(min, Math.min(max, n));
}

export function text(v: unknown, what: string): string {
  if (typeof v !== "string") throw new Error(`${what} must be a string`);
  return v;
}

export function bool(v: unknown, what: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${what} must be true or false`);
  return v;
}
