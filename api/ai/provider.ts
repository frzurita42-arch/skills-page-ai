import { getDb } from "../queries/connection";
import { apiKeys } from "@db/schema";
import { and, eq } from "drizzle-orm";
import { getSettings } from "../settings";
import type { AiCapability, AiProvider } from "@contracts/types";

/* ------------------------------------------------------------------ */
/* Pluggable text-completion provider layer.                            */
/* Priority: user's BYOK key for the capability -> platform key from    */
/* settings -> server .env key -> null (caller falls back to the        */
/* deterministic mock).                                                 */
/* Server-side only — keys NEVER leave the server.                      */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ResolvedKey {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  /** Override the provider's default model (e.g. OpenRouter/DeepSeek routes). */
  model?: string;
  source: "byok" | "platform" | "env";
}

export interface CompletionResult {
  text: string;
  provider: AiProvider;
  source: "byok" | "platform" | "env";
}

const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash",
};

const DEFAULT_BASE_URLS: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

/**
 * Resolve a key from server environment variables (.env). This is the final
 * fallback tier so the platform works out of the box with the keys documented
 * in .env.example — no admin/settings step required.
 */
function envKeyFor(capability: AiCapability): ResolvedKey | null {
  const e = process.env;
  const val = (name: string) => (e[name]?.trim() ? e[name]!.trim() : null);

  if (capability === "image") {
    const gemini = val("GEMINI_API_KEY");
    if (gemini) {
      return { provider: "gemini", apiKey: gemini, model: val("GEMINI_IMAGE_MODEL") ?? undefined, source: "env" };
    }
    const imageKey = val("IMAGE_API_KEY") ?? val("OPENAI_API_KEY");
    if (imageKey) {
      // IMAGE_API_URL may be the full endpoint; callers append /images/generations.
      const baseUrl = val("IMAGE_API_URL")?.replace(/\/images\/generations\/?$/, "") ?? undefined;
      return { provider: "openai", apiKey: imageKey, baseUrl, model: val("IMAGE_API_MODEL") ?? undefined, source: "env" };
    }
    return null;
  }

  if (capability === "text") {
    const gemini = val("GEMINI_API_KEY");
    if (gemini) {
      return { provider: "gemini", apiKey: gemini, model: val("GEMINI_TEXT_MODEL") ?? undefined, source: "env" };
    }
    const anthropic = val("ANTHROPIC_API_KEY");
    if (anthropic) {
      return { provider: "anthropic", apiKey: anthropic, model: val("ANTHROPIC_MODEL") ?? undefined, source: "env" };
    }
    const openai = val("OPENAI_API_KEY");
    if (openai) return { provider: "openai", apiKey: openai, source: "env" };
    const deepseek = val("DEEPSEEK_API_KEY");
    if (deepseek) {
      return { provider: "openai", apiKey: deepseek, baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", source: "env" };
    }
    const openrouter = val("OPENROUTER_API_KEY");
    if (openrouter) {
      return { provider: "openai", apiKey: openrouter, baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", source: "env" };
    }
    const kimi = val("KIMI_API_KEY");
    if (kimi) {
      return { provider: "openai", apiKey: kimi, baseUrl: "https://api.moonshot.ai/v1", model: "moonshot-v1-8k", source: "env" };
    }
  }
  return null;
}

/** Resolve the key to use for a capability: BYOK first, then platform settings, then .env. */
export async function resolveKey(
  userId: number | undefined,
  capability: AiCapability,
): Promise<ResolvedKey | null> {
  if (userId) {
    const rows = await getDb()
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.capability, capability)));
    if (rows.length > 0 && rows[0].apiKey.trim()) {
      return {
        provider: rows[0].provider,
        apiKey: rows[0].apiKey.trim(),
        source: "byok",
      };
    }
  }
  const settings = await getSettings();
  const platform = settings.platformAiKeys[capability];
  if (platform?.apiKey?.trim()) {
    return {
      provider: platform.provider,
      apiKey: platform.apiKey.trim(),
      baseUrl: platform.baseUrl,
      source: "platform",
    };
  }
  return envKeyFor(capability);
}

/** True when the user has any BYOK key for a capability (used by estimate). */
export async function userHasKey(userId: number, capability: AiCapability): Promise<boolean> {
  const rows = await getDb()
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.capability, capability)))
    .limit(1);
  return rows.length > 0;
}

async function callOpenAICompatible(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key.apiKey}`,
    },
    body: JSON.stringify({
      model: key.model || DEFAULT_MODELS.openai,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI-compatible API returned no content");
  return text;
}

async function callAnthropic(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.anthropic).replace(/\/$/, "");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: key.model || DEFAULT_MODELS.anthropic,
      max_tokens: maxTokens,
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic API returned no text");
  return text;
}

async function callGemini(
  key: ResolvedKey,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const res = await fetch(
    `${base}/models/${key.model || DEFAULT_MODELS.gemini}:generateContent?key=${encodeURIComponent(key.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini API returned no content");
  return text;
}

/**
 * Run a text completion. Returns null when no key is configured at all —
 * the caller then uses the deterministic mock so the platform stays demo-able.
 */
export async function completeText(opts: {
  userId?: number;
  capability?: AiCapability;
  messages: ChatMessage[];
  maxTokens?: number;
}): Promise<CompletionResult | null> {
  const capability = opts.capability ?? "text";
  const key = await resolveKey(opts.userId, capability);
  if (!key) return null;

  const maxTokens = opts.maxTokens ?? 4096;
  let text: string;
  try {
    switch (key.provider) {
      case "openai":
        text = await callOpenAICompatible(key, opts.messages, maxTokens);
        break;
      case "anthropic":
        text = await callAnthropic(key, opts.messages, maxTokens);
        break;
      case "gemini":
        text = await callGemini(key, opts.messages, maxTokens);
        break;
    }
  } catch (err) {
    // Network/provider failures (unreachable host, timeout, bad key, quota)
    // must never bubble up to the client as a 500 — fall back to the mock.
    console.warn(
      `[ai/text] ${key.provider} completion failed, using mock fallback:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
  return { text, provider: key.provider, source: key.source };
}

/**
 * Minimal provider ping used by keys.test. Text/tts keys get a one-token
 * round trip; image keys get a cheap endpoint check against the image model
 * (model metadata lookup — no paid generation).
 */
export async function testKey(
  provider: AiProvider,
  apiKey: string,
  baseUrl?: string,
  capability: AiCapability = "text",
): Promise<void> {
  if (capability === "image") {
    switch (provider) {
      case "gemini": {
        const base = (baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
        const res = await fetch(`${base}/models/${GEMINI_IMAGE_MODELS[0]}`, {
          headers: { "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok)
          throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
      }
      case "openai": {
        const base = (baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
        const res = await fetch(`${base}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok)
          throw new Error(`OpenAI-compatible API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return;
      }
      case "anthropic":
        throw new Error("Anthropic has no image generation API");
    }
  }
  const key: ResolvedKey = { provider, apiKey, baseUrl, source: "byok" };
  const messages: ChatMessage[] = [
    { role: "system", content: 'Reply with exactly: {"ok":true}' },
    { role: "user", content: "ping" },
  ];
  switch (provider) {
    case "openai":
      await callOpenAICompatible(key, messages, 16);
      return;
    case "anthropic":
      await callAnthropic(key, messages, 16);
      return;
    case "gemini":
      await callGemini(key, messages, 16);
      return;
  }
}

/* ------------------------------------------------------------------ */
/* Image generation. Returns a base64 data URI, or null on ANY failure  */
/* (no key configured, provider error, unsupported provider) — callers  */
/* always keep the style-thumbnail fallback. Keys never leave the server */
/* ------------------------------------------------------------------ */

const IMAGE_STYLE_DIRECTIVES: Record<string, string> = {
  sketch: "hand-drawn pencil sketch on warm cream paper, ink outlines, minimal color",
  watercolor: "loose warm watercolor on paper",
  flat: "flat vector illustration, bold ink outlines, warm palette",
  photo: "warm editorial photograph, soft daylight",
};

/** "Nano banana" = Gemini 2.5 Flash Image; fall back on 404. */
const GEMINI_IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
];

async function callGeminiImage(key: ResolvedKey, prompt: string): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
  let notFound: Error | null = null;
  const models = key.model ? [key.model, ...GEMINI_IMAGE_MODELS] : GEMINI_IMAGE_MODELS;
  for (const model of models) {
    const res = await fetch(`${base}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 404) {
      notFound = new Error(`Gemini image model ${model} not found (404)`);
      continue;
    }
    if (!res.ok)
      throw new Error(`Gemini image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    };
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("Gemini image API returned no image data");
    return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
  }
  throw notFound ?? new Error("No Gemini image model available");
}

async function callOpenAIImage(key: ResolvedKey, prompt: string): Promise<string> {
  const base = (key.baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "");
  const request = (body: Record<string, unknown>) =>
    fetch(`${base}/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

  let res = await request({
    model: key.model || "gpt-image-1",
    prompt,
    size: "1024x1024",
    response_format: "b64_json",
  });
  if (!res.ok && (res.status === 400 || res.status === 404)) {
    // model/param rejected — retry dall-e-3 (no response_format param)
    res = await request({ model: "dall-e-3", prompt, size: "1024x1024" });
  }
  if (!res.ok)
    throw new Error(`OpenAI image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = data.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!img.ok) throw new Error(`OpenAI image URL fetch failed: ${img.status}`);
    const mime = img.headers.get("content-type")?.split(";")[0] || "image/png";
    const buf = Buffer.from(await img.arrayBuffer());
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  throw new Error("OpenAI image API returned no image");
}

/**
 * Generate one image for a slide. Returns a `data:image/...;base64,...` URI,
 * or null when no image key is configured or the call fails (reason logged
 * server-side). Style directive is prepended to keep the SketchLearn look.
 */
export async function generateImage(opts: {
  userId?: number;
  prompt: string;
  style?: string;
}): Promise<string | null> {
  try {
    const key = await resolveKey(opts.userId, "image");
    if (!key) return null;
    const directive = opts.style ? IMAGE_STYLE_DIRECTIVES[opts.style] : undefined;
    const prompt = directive ? `${opts.prompt}\n\nStyle: ${directive}.` : opts.prompt;
    switch (key.provider) {
      case "gemini":
        return await callGeminiImage(key, prompt);
      case "openai":
        return await callOpenAIImage(key, prompt);
      case "anthropic":
        console.warn("[ai/image] Anthropic has no image generation API — skipping");
        return null;
    }
  } catch (err) {
    console.warn("[ai/image] generation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
