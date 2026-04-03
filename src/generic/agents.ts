import os from "node:os";
import path from "node:path";
import { readdirSync } from "node:fs";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import type { AgentListItem } from "./types.js";

const DEFAULT_AGENT_ID = "main";
const DEFAULT_MAIN_KEY = "main";
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

type GenericPeerKind = "dm" | "group" | "channel";

type GenericAgentEntry = {
  id: string;
  name: string;
  isDefault: boolean;
  identityName?: string;
  identityEmoji?: string;
  model?: string;
  description?: string;
  skills: string[];
  /** Skills explicitly declared in agent config (subset of skills) */
  configuredSkills: string[];
  status: "online" | "idle" | "busy";
  workspace?: string;
};

function normalizeLowerToken(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeAgentId(value?: string | null): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_AGENT_ID;
  }

  if (VALID_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return (
    trimmed
      .toLowerCase()
      .replace(INVALID_CHARS_RE, "-")
      .replace(LEADING_DASH_RE, "")
      .replace(TRAILING_DASH_RE, "")
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

function normalizeMainKey(value?: string | null): string {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.toLowerCase() : DEFAULT_MAIN_KEY;
}

function resolveSkillNames(skills: unknown): string[] {
  if (!Array.isArray(skills)) {
    return [];
  }

  const names = skills
    .map((skill) => {
      if (typeof skill === "string") {
        return skill.trim();
      }

      if (skill && typeof skill === "object" && typeof (skill as { name?: unknown }).name === "string") {
        return (skill as { name: string }).name.trim();
      }

      return "";
    })
    .filter((name): name is string => Boolean(name));

  return Array.from(new Set(names));
}

/** Scan filesystem for installed skill directory names */
function scanInstalledSkills(workspace?: string, agentId?: string): string[] {
  const dirs: string[] = [];
  // Global skills: ~/.openclaw/skills/
  const globalDir = path.join(os.homedir(), ".openclaw", "skills");
  try {
    const entries = readdirSync(globalDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) dirs.push(e.name);
    }
  } catch {
    /* ignore */
  }
  // npm-installed skills (user-local)
  const npmDir = path.join(os.homedir(), ".npm-global", "lib", "node_modules", "openclaw", "skills");
  try {
    const entries = readdirSync(npmDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) dirs.push(e.name);
    }
  } catch {
    /* ignore */
  }
  // npm-installed skills (system-wide, e.g. /usr/lib/node_modules/openclaw/skills)
  const systemNpmDir = "/usr/lib/node_modules/openclaw/skills";
  if (systemNpmDir !== npmDir) {
    try {
      const entries = readdirSync(systemNpmDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) dirs.push(e.name);
      }
    } catch {
      /* ignore */
    }
  }
  // Workspace skills (explicit path or inferred from agentId)
  const wsPaths: string[] = [];
  if (workspace) {
    wsPaths.push(path.join(resolveUserPathLike(workspace), "skills"));
  }
  if (agentId) {
    wsPaths.push(path.join(os.homedir(), ".openclaw", `workspace-${agentId}`, "skills"));
  }
  for (const wsDir of wsPaths) {
    try {
      const entries = readdirSync(wsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !dirs.includes(e.name)) dirs.push(e.name);
      }
    } catch {
      /* ignore */
    }
  }
  return Array.from(new Set(dirs));
}

function resolveUserPathLike(rawPath: string): string {
  const trimmed = rawPath.trim();
  const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
  return path.resolve(expanded);
}

function resolveLinkedPeerId(params: {
  identityLinks?: Record<string, string[]>;
  channel: string;
  peerId: string;
}): string | null {
  const { identityLinks } = params;
  if (!identityLinks) {
    return null;
  }

  const peerId = params.peerId.trim();
  if (!peerId) {
    return null;
  }

  const candidates = new Set<string>();
  const rawCandidate = normalizeLowerToken(peerId);
  if (rawCandidate) {
    candidates.add(rawCandidate);
  }

  const channel = normalizeLowerToken(params.channel);
  if (channel) {
    const scopedCandidate = normalizeLowerToken(`${channel}:${peerId}`);
    if (scopedCandidate) {
      candidates.add(scopedCandidate);
    }
  }

  for (const [canonical, ids] of Object.entries(identityLinks)) {
    const canonicalName = canonical.trim();
    if (!canonicalName || !Array.isArray(ids)) {
      continue;
    }

    for (const id of ids) {
      const normalized = normalizeLowerToken(id);
      if (normalized && candidates.has(normalized)) {
        return canonicalName;
      }
    }
  }

  return null;
}

function resolveConfiguredAgents(cfg: OpenClawConfig): {
  agents: GenericAgentEntry[];
  defaultAgentId: string;
} {
  const configuredList = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const normalizedEntries = configuredList
    .map((agent) => {
      const normalizedId = normalizeAgentId(agent?.id);
      const primaryModel =
        typeof agent?.model === "string"
          ? agent.model
          : typeof agent?.model?.primary === "string"
            ? agent.model.primary
            : undefined;

      return {
        id: normalizedId,
        name: String(agent?.name ?? agent?.identity?.name ?? normalizedId).trim() || normalizedId,
        identityName:
          typeof agent?.identity?.name === "string" && agent.identity.name.trim()
            ? agent.identity.name.trim()
            : undefined,
        identityEmoji:
          typeof agent?.identity?.emoji === "string" && agent.identity.emoji.trim()
            ? agent.identity.emoji.trim()
            : undefined,
        model: primaryModel?.trim() || undefined,
        description:
          typeof (agent?.identity as Record<string, unknown>)?.description === "string" && (agent.identity as Record<string, unknown>).description
            ? String((agent.identity as Record<string, unknown>).description).trim()
            : undefined,
        skills: (() => {
          const configured = resolveSkillNames(agent?.skills);
          const scanned = scanInstalledSkills(
            typeof agent?.workspace === "string" && agent.workspace.trim() ? agent.workspace.trim() : undefined,
            normalizedId,
          );
          // Merge: configured first, then scanned (deduped)
          const all = [...configured];
          for (const s of scanned) {
            if (!all.includes(s)) all.push(s);
          }
          return all;
        })(),
        configuredSkills: resolveSkillNames(agent?.skills),
        workspace:
          typeof agent?.workspace === "string" && agent.workspace.trim() ? agent.workspace.trim() : undefined,
        status: "online" as const,
        default: agent?.default === true,
      };
    })
    .filter((agent) => Boolean(agent.id));

  const deduped: GenericAgentEntry[] = [];
  const seen = new Set<string>();
  for (const agent of normalizedEntries) {
    if (seen.has(agent.id)) {
      continue;
    }
    seen.add(agent.id);
    deduped.push({
      id: agent.id,
      name: agent.name,
      identityName: agent.identityName,
      identityEmoji: agent.identityEmoji,
      model: agent.model,
      description: agent.description,
      skills: agent.skills,
      configuredSkills: agent.configuredSkills,
      status: agent.status,
      workspace: agent.workspace,
      isDefault: false,
    });
  }

  const fallbackDefaultId =
    normalizedEntries.find((agent) => agent.default)?.id ??
    deduped[0]?.id ??
    DEFAULT_AGENT_ID;

  if (deduped.length === 0) {
    return {
      defaultAgentId: fallbackDefaultId,
      agents: [
        {
          id: fallbackDefaultId,
          name: fallbackDefaultId,
          isDefault: true,
          skills: [],
          configuredSkills: [],
          status: "online",
        },
      ],
    };
  }

  return {
    defaultAgentId: fallbackDefaultId,
    agents: deduped.map((agent) => ({
      ...agent,
      isDefault: agent.id === fallbackDefaultId,
    })),
  };
}

function buildMainSessionKey(cfg: OpenClawConfig, agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:${normalizeMainKey(cfg.session?.mainKey)}`;
}

function buildPeerSessionKey(params: {
  cfg: OpenClawConfig;
  agentId: string;
  channel: string;
  accountId?: string;
  peerKind: GenericPeerKind;
  peerId: string;
}): string {
  const agentId = normalizeAgentId(params.agentId);
  const channel = normalizeLowerToken(params.channel) || "unknown";
  const peerKind = params.peerKind;
  let peerId = String(params.peerId ?? "").trim();

  if (peerKind !== "dm") {
    return `agent:${agentId}:${channel}:${peerKind}:${normalizeLowerToken(peerId) || "unknown"}`;
  }

  const dmScope = cfgDmScope(params.cfg);
  const linkedPeerId =
    dmScope === "main"
      ? null
      : resolveLinkedPeerId({
          identityLinks: params.cfg.session?.identityLinks as Record<string, string[]> | undefined,
          channel,
          peerId,
        });

  if (linkedPeerId) {
    peerId = linkedPeerId;
  }

  const normalizedPeerId = normalizeLowerToken(peerId);

  if (dmScope === "per-account-channel-peer" && normalizedPeerId) {
    return `agent:${agentId}:${channel}:${normalizeAgentAccountId(params.accountId)}:dm:${normalizedPeerId}`;
  }

  if (dmScope === "per-channel-peer" && normalizedPeerId) {
    return `agent:${agentId}:${channel}:dm:${normalizedPeerId}`;
  }

  if (dmScope === "per-peer" && normalizedPeerId) {
    return `agent:${agentId}:dm:${normalizedPeerId}`;
  }

  return buildMainSessionKey(params.cfg, agentId);
}

function cfgDmScope(cfg: OpenClawConfig): string {
  return String(cfg.session?.dmScope ?? "main").trim() || "main";
}

function normalizeAgentAccountId(value?: string | null): string {
  const trimmed = String(value ?? "").trim();
  return trimmed ? normalizeLowerToken(trimmed) : DEFAULT_ACCOUNT_ID;
}

export function listGenericAgents(cfg: OpenClawConfig): {
  agents: AgentListItem[];
  defaultAgentId: string;
} {
  const resolved = resolveConfiguredAgents(cfg);
  return {
    defaultAgentId: resolved.defaultAgentId,
    agents: resolved.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      isDefault: agent.isDefault,
      identityName: agent.identityName,
      identityEmoji: agent.identityEmoji,
      model: agent.model,
      description: agent.description,
      skills: agent.skills,
      configuredSkills: agent.configuredSkills.length > 0 ? agent.configuredSkills : undefined,
      status: agent.status,
    })),
  };
}

export function resolveGenericAgentWorkspaceCandidates(cfg: OpenClawConfig, agentId: string): string[] {
  const normalizedAgentId = normalizeAgentId(agentId);
  const { agents, defaultAgentId } = resolveConfiguredAgents(cfg);
  const matchedAgent = agents.find((agent) => agent.id === normalizedAgentId);
  const candidates = new Set<string>();

  if (matchedAgent?.workspace) {
    candidates.add(resolveUserPathLike(matchedAgent.workspace));
  }

  const defaultsWorkspace =
    typeof cfg.agents?.defaults?.workspace === "string" && cfg.agents.defaults.workspace.trim()
      ? resolveUserPathLike(cfg.agents.defaults.workspace)
      : undefined;

  if (normalizedAgentId === defaultAgentId && defaultsWorkspace) {
    candidates.add(defaultsWorkspace);
  }

  candidates.add(path.join(os.homedir(), ".openclaw", `workspace-${normalizedAgentId}`));

  if (normalizedAgentId === defaultAgentId) {
    candidates.add(path.join(os.homedir(), ".openclaw", "workspace"));
  }

  return Array.from(candidates);
}

export function resolveGenericAgentModel(cfg: OpenClawConfig, agentId: string): string | undefined {
  const normalizedId = normalizeAgentId(agentId);
  const { agents } = resolveConfiguredAgents(cfg);
  return agents.find((agent) => agent.id === normalizedId)?.model;
}

export function resolveGenericAgentId(
  cfg: OpenClawConfig,
  requestedAgentId?: string | null,
): string | undefined {
  if (!String(requestedAgentId ?? "").trim()) {
    return undefined;
  }

  const normalizedRequested = normalizeAgentId(requestedAgentId);
  const { agents } = resolveConfiguredAgents(cfg);
  const match = agents.find((agent) => agent.id === normalizedRequested);
  if (match) {
    return match.id;
  }

  if (agents.length === 0 && normalizedRequested === DEFAULT_AGENT_ID) {
    return DEFAULT_AGENT_ID;
  }

  return undefined;
}

export function resolveExplicitGenericAgentRoute(params: {
  cfg: OpenClawConfig;
  requestedAgentId?: string | null;
  chatType: "direct" | "group";
  chatId: string;
  senderId: string;
}):
  | {
      agentId: string;
      accountId: string;
      sessionKey: string;
      mainSessionKey: string;
    }
  | undefined {
  const agentId = resolveGenericAgentId(params.cfg, params.requestedAgentId);
  if (!agentId) {
    return undefined;
  }

  const peerKind: GenericPeerKind = params.chatType === "group" ? "group" : "dm";
  const peerId = params.chatId;
  const sessionKey = buildPeerSessionKey({
    cfg: params.cfg,
    agentId,
    channel: "clawline",
    accountId: DEFAULT_ACCOUNT_ID,
    peerKind,
    peerId,
  });

  return {
    agentId,
    accountId: DEFAULT_ACCOUNT_ID,
    sessionKey,
    mainSessionKey: buildMainSessionKey(params.cfg, agentId),
  };
}
