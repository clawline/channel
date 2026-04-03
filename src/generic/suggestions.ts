/**
 * Server-side AI suggestion generator.
 * Uses the host machine's OpenClaw model provider config to generate
 * contextual follow-up suggestions, so clients don't need their own API keys.
 */
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

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

/**
 * Resolve a usable model provider from OpenClaw config.
 * Prefers: azure-foundry > openai > any provider with api-key auth.
 * Picks a small/cheap model when possible (gpt-4.1, gpt-5-mini, etc.)
 */
function resolveProvider(cfg: OpenClawConfig): {
  baseUrl: string;
  apiKey: string;
  model: string;
  isAzureOpenAI: boolean;
} | null {
  // OpenClaw config nests providers under cfg.models.providers
  const cfgAny = cfg as Record<string, unknown>;
  const modelsSection = cfgAny.models as Record<string, unknown> | undefined;
  const providers = (modelsSection?.providers ?? cfgAny.providers) as
    | Record<string, { baseUrl?: string; apiKey?: unknown; auth?: string; models?: Array<{ id: string }> }>
    | undefined;
  if (!providers) return null;

  // Priority order for provider selection
  const preferredProviders = ["azure-foundry", "openai", "github-copilot"];
  // Preferred small models for suggestion generation (cheap & fast)
  const preferredModels = ["gpt-4.1", "GPT-4.1", "gpt-5-mini", "gpt-4o-mini", "gpt-4o", "gpt-5.2"];

  for (const providerName of [...preferredProviders, ...Object.keys(providers)]) {
    const provider = providers[providerName];
    if (!provider?.baseUrl) continue;

    // Resolve API key
    let apiKey = "";
    if (typeof provider.apiKey === "string") {
      apiKey = provider.apiKey;
    } else if (provider.apiKey && typeof provider.apiKey === "object") {
      // SecretInput: could be { env: "VAR_NAME" } or { value: "..." }
      const secretInput = provider.apiKey as Record<string, string>;
      if (secretInput.value) {
        apiKey = secretInput.value;
      } else if (secretInput.env) {
        apiKey = process.env[secretInput.env] ?? "";
      }
    }

    if (!apiKey && provider.auth !== "oauth") continue;

    // Pick a model
    const modelIds = provider.models?.map((m) => m.id) ?? [];
    let model = "";
    for (const preferred of preferredModels) {
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
      // Azure OpenAI uses deployment-based URLs; Azure Foundry uses /openai/v1 (OpenAI-compatible)
      isAzureOpenAI: provider.baseUrl.includes(".openai.azure.com") && !provider.baseUrl.includes("/openai/v1"),
    };
  }

  return null;
}

export async function generateSuggestions(
  cfg: OpenClawConfig,
  recentMessages: Array<{ role: string; text: string }>,
  signal?: AbortSignal,
): Promise<SuggestionResult> {
  const provider = resolveProvider(cfg);
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
    // Azure OpenAI (not Foundry) uses deployment-based URLs
    const base = baseUrl
      .replace(/\/openai\/v1\/?$/, "")
      .replace(/\/openai\/?$/, "")
      .replace(/\/+$/, "");
    url = `${base}/openai/deployments/${model}/chat/completions?api-version=2025-01-01-preview`;
    headers["api-key"] = apiKey;
  } else {
    // Standard OpenAI-compatible or Azure Foundry (openai/v1 endpoint)
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
