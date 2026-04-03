/**
 * Server-side AI suggestion generator.
 * Uses the OpenClaw plugin SDK (modelAuth) to resolve provider credentials,
 * so clients don't need their own API keys.
 */
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { getGenericRuntime } from "./runtime.js";

interface SuggestionResult {
  suggestions: string[];
  error?: string;
}

const SYSTEM_PROMPT = `You are a suggestion generator for a chat interface. Based on the conversation context, generate 3-4 short follow-up questions or prompts the user might want to ask next.

Rules:
- Each suggestion must be under 20 characters (Chinese or English)
- Make suggestions relevant and diverse
- Mix between clarifying questions, deeper exploration, and action requests
- Output ONLY a JSON array of strings, nothing else
- If the conversation is in Chinese, generate Chinese suggestions
- If in English, generate English suggestions
- Match the language and tone of the conversation`;

// Preferred provider order
const PREFERRED_PROVIDERS = ["azure-foundry", "openai", "github-copilot"];
// Preferred small/cheap models
const PREFERRED_MODELS = ["gpt-4.1", "GPT-4.1", "gpt-5-mini", "gpt-4o-mini", "gpt-4o", "gpt-5.2"];

/**
 * Resolve a usable provider, model, and API key using the SDK's modelAuth.
 */
async function resolveProviderViaSDK(cfg: OpenClawConfig): Promise<{
  baseUrl: string;
  apiKey: string;
  model: string;
  isAzureOpenAI: boolean;
} | null> {
  const runtime = getGenericRuntime();

  // Access providers from config
  const cfgAny = cfg as Record<string, unknown>;
  const modelsSection = cfgAny.models as Record<string, unknown> | undefined;
  const providers = (modelsSection?.providers ?? cfgAny.providers) as
    | Record<string, { baseUrl?: string; models?: Array<{ id: string }>; auth?: string }>
    | undefined;
  if (!providers) return null;

  // Try preferred providers first, then any available
  const providerNames = [
    ...PREFERRED_PROVIDERS.filter((p) => p in providers),
    ...Object.keys(providers).filter((p) => !PREFERRED_PROVIDERS.includes(p)),
  ];

  for (const providerName of providerNames) {
    const provider = providers[providerName];
    if (!provider?.baseUrl) continue;

    // Use SDK modelAuth to resolve the API key
    let apiKey = "";
    try {
      const auth = await runtime.modelAuth.resolveApiKeyForProvider({
        provider: providerName,
        cfg,
      });
      apiKey = auth?.apiKey ?? "";
    } catch {
      // Fallback: skip this provider
      continue;
    }

    if (!apiKey && provider.auth !== "oauth") continue;

    // Pick a model
    const modelIds = provider.models?.map((m) => m.id) ?? [];
    let model = "";
    for (const preferred of PREFERRED_MODELS) {
      if (modelIds.includes(preferred)) {
        model = preferred;
        break;
      }
    }
    if (!model && modelIds.length > 0) {
      model = modelIds[0];
    }
    if (!model) model = "gpt-4.1";

    return {
      baseUrl: provider.baseUrl.replace(/\/+$/, ""),
      apiKey,
      model,
      isAzureOpenAI:
        provider.baseUrl.includes(".openai.azure.com") && !provider.baseUrl.includes("/openai/v1"),
    };
  }

  return null;
}

export async function generateSuggestions(
  cfg: OpenClawConfig,
  recentMessages: Array<{ role: string; text: string }>,
  signal?: AbortSignal,
): Promise<SuggestionResult> {
  const provider = await resolveProviderViaSDK(cfg);

  if (!provider) {
    return { suggestions: [], error: "no-provider" };
  }

  const conversationContext = recentMessages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 300)}`)
    .join("\n");

  const { baseUrl, apiKey, model, isAzureOpenAI } = provider;

  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isAzureOpenAI) {
    const base = baseUrl
      .replace(/\/openai\/v1\/?$/, "")
      .replace(/\/openai\/?$/, "")
      .replace(/\/+$/, "");
    url = `${base}/openai/deployments/${model}/chat/completions?api-version=2025-01-01-preview`;
    headers["api-key"] = apiKey;
  } else {
    const base = baseUrl.replace(/\/+$/, "");
    url = `${base}/chat/completions`;
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...(isAzureOpenAI ? {} : { model }),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Recent conversation:\n${conversationContext}\n\nGenerate 3-4 follow-up suggestions:`,
          },
        ],
        temperature: 0.8,
        max_tokens: 200,
      }),
      signal,
    });

    if (!res.ok) {
      return { suggestions: [], error: `api-${res.status}` };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { suggestions: [], error: "empty-response" };

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return {
          suggestions: parsed
            .filter((s: unknown): s is string => typeof s === "string" && s.length > 0)
            .slice(0, 5),
        };
      }
    } catch {
      // Try to extract JSON array from response
      const match = content.match(/\[[\s\S]*?\]/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            return {
              suggestions: parsed
                .filter((s: unknown): s is string => typeof s === "string" && s.length > 0)
                .slice(0, 5),
            };
          }
        } catch {
          /* ignore */
        }
      }
    }

    return { suggestions: [], error: "parse-error" };
  } catch (err) {
    if (signal?.aborted) return { suggestions: [], error: "aborted" };
    return { suggestions: [], error: String(err) };
  }
}
