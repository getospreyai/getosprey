// Minimal fetch-based client for OpenRouter's OpenAI-compatible Chat
// Completions endpoint. Not a framework — a seam so llm.ts can swap LLM
// providers without touching respond.ts or anything downstream. Wire shapes
// (request/response/error) verified against openrouter.ai docs 2026-07-20.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatCompleteOpts {
  model: string;
  system?: string;
  user: string;
  /** OpenAI-style response_format, e.g. { type: "json_schema", json_schema: {...} }. */
  responseFormat?: object;
  maxTokens: number;
  /** Fallback models, tried in order after `model` on error/rate-limit/etc. */
  models?: string[];
}

export interface ChatCompleteResult {
  text: string;
  finishReason: string | null;
  /** Which model actually served the request — with a `models` fallback chain
   *  this is not necessarily the requested one. */
  model: string | null;
}

/** Thrown when OPENROUTER_API_KEY is unset. Distinct from OpenRouterError
 *  (no HTTP response exists yet) — callers always propagate this one. */
export class OpenRouterConfigError extends Error {
  constructor(message = "OPENROUTER_API_KEY is not configured.") {
    super(message);
    this.name = "OpenRouterConfigError";
  }
}

/** Any non-2xx response. `status` mirrors the HTTP status (== the API's
 *  error.code) so callers can branch — e.g. 404/429 are recoverable free-tier
 *  conditions, 401 is a real auth failure. */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export async function chatComplete(opts: ChatCompleteOpts): Promise<ChatCompleteResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterConfigError();

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens,
  };
  if (opts.models?.length) body.models = opts.models;
  if (opts.responseFormat) {
    body.response_format = opts.responseFormat;
    // Belt-and-suspenders: without this, OpenRouter can silently route to a
    // provider that drops response_format and returns prose instead of JSON.
    body.provider = { require_parameters: true };
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://getosprey.ai",
      "X-Title": "Osprey",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();

  if (!res.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // body wasn't JSON — fall back to the raw text
    }
    throw new OpenRouterError(`OpenRouter ${res.status}: ${detail || res.statusText}`, res.status);
  }

  const json = JSON.parse(raw) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
    error?: { code?: number; message?: string };
  };
  // OpenRouter can commit a 200 status, stream keep-alive padding, then land
  // an error object in the body when the upstream provider fails mid-flight.
  if (json.error) {
    throw new OpenRouterError(
      `OpenRouter in-body error: ${json.error.message ?? "unknown"}`,
      json.error.code ?? res.status,
    );
  }
  const choice = json.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    finishReason: choice?.finish_reason ?? null,
    model: json.model ?? null,
  };
}
