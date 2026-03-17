import type { GenericChannelConfig } from "./types.js";

export type GenericAuthUser = {
  id: string;
  senderId: string;
  chatId?: string;
  token: string;
  allowAgents?: string[];
};

export type GenericConnectionQuery = {
  chatId?: string;
  agentId?: string;
  token?: string;
};

export type GenericConnectionAuthResult =
  | {
      ok: true;
      query: GenericConnectionQuery;
      authUser?: GenericAuthUser;
    }
  | {
      ok: false;
      code: number;
      message: string;
      query: GenericConnectionQuery;
    };

function normalizeNonEmpty(value?: string | null): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

function normalizeAgentList(agents?: string[]): string[] | undefined {
  if (!Array.isArray(agents)) {
    return undefined;
  }

  const normalized = agents
    .map((agent) => normalizeNonEmpty(agent)?.toLowerCase())
    .filter((agent): agent is string => Boolean(agent));

  if (normalized.includes("*")) {
    return undefined;
  }

  return normalized.length > 0 ? normalized : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getGenericAuthConfig(config: GenericChannelConfig): NonNullable<GenericChannelConfig["auth"]> | undefined {
  return config.auth?.enabled ? config.auth : undefined;
}

export function getGenericAuthTokenParam(config: GenericChannelConfig): string {
  return normalizeNonEmpty(config.auth?.tokenParam) ?? "token";
}

export function parseGenericConnectionQuery(params: {
  url: string;
  tokenParam: string;
}): GenericConnectionQuery {
  const { url, tokenParam } = params;

  try {
    const parsed = new URL(url, "ws://clawline.local");
    return {
      chatId: normalizeNonEmpty(parsed.searchParams.get("chatId")),
      agentId: normalizeNonEmpty(parsed.searchParams.get("agentId")),
      token: normalizeNonEmpty(parsed.searchParams.get(tokenParam)),
    };
  } catch {
    const tokenPattern = escapeRegex(tokenParam);
    const chatMatch = url.match(/[?&]chatId=([^&]+)/);
    const agentMatch = url.match(/[?&]agentId=([^&]+)/);
    const tokenMatch = url.match(new RegExp(`[?&]${tokenPattern}=([^&]+)`));

    return {
      chatId: chatMatch ? normalizeNonEmpty(decodeURIComponent(chatMatch[1])) : undefined,
      agentId: agentMatch ? normalizeNonEmpty(decodeURIComponent(agentMatch[1])) : undefined,
      token: tokenMatch ? normalizeNonEmpty(decodeURIComponent(tokenMatch[1])) : undefined,
    };
  }
}

export function findGenericAuthUserByToken(params: {
  config: GenericChannelConfig;
  token?: string;
}): GenericAuthUser | undefined {
  const auth = getGenericAuthConfig(params.config);
  const token = normalizeNonEmpty(params.token);

  if (!auth || !token) {
    return undefined;
  }

  for (const entry of auth.users ?? []) {
    if (entry.enabled === false) {
      continue;
    }

    const configuredToken = normalizeNonEmpty(entry.token);
    if (!configuredToken || configuredToken !== token) {
      continue;
    }

    const senderId = normalizeNonEmpty(entry.senderId);
    if (!senderId) {
      continue;
    }

    return {
      id: normalizeNonEmpty(entry.id) ?? senderId,
      senderId,
      chatId: normalizeNonEmpty(entry.chatId),
      token: configuredToken,
      allowAgents: normalizeAgentList(entry.allowAgents),
    };
  }

  return undefined;
}

export function authenticateGenericConnection(params: {
  config: GenericChannelConfig;
  url: string;
}): GenericConnectionAuthResult {
  const tokenParam = getGenericAuthTokenParam(params.config);
  const query = parseGenericConnectionQuery({
    url: params.url,
    tokenParam,
  });
  const auth = getGenericAuthConfig(params.config);

  if (!auth) {
    return {
      ok: true,
      query,
    };
  }

  if (!query.token) {
    return {
      ok: false,
      code: 401,
      message: `Missing ${tokenParam}`,
      query,
    };
  }

  const authUser = findGenericAuthUserByToken({
    config: params.config,
    token: query.token,
  });

  if (!authUser) {
    return {
      ok: false,
      code: 401,
      message: "Invalid token",
      query,
    };
  }

  if (authUser.chatId && query.chatId && query.chatId !== authUser.chatId) {
    return {
      ok: false,
      code: 403,
      message: "chatId does not match token binding",
      query,
    };
  }

  return {
    ok: true,
    query,
    authUser,
  };
}

export function isGenericAgentAllowed(params: {
  allowedAgents?: string[];
  requestedAgentId?: string | null;
}): boolean {
  const requestedAgentId = normalizeNonEmpty(params.requestedAgentId)?.toLowerCase();
  if (!requestedAgentId) {
    return true;
  }

  if (!params.allowedAgents || params.allowedAgents.length === 0) {
    return true;
  }

  return params.allowedAgents.includes(requestedAgentId);
}
