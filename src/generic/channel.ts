import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk";
import type { ResolvedGenericAccount, GenericChannelConfig } from "./types.js";
import { genericOutbound } from "./outbound.js";
import { probeGeneric } from "./probe.js";
import { sendMessageGeneric } from "./send.js";

const meta = {
  id: "clawline",
  label: "Clawline",
  selectionLabel: "Clawline (WebSocket/Relay/Webhook)",
  docsPath: "/channels/clawline",
  docsLabel: "clawline",
  blurb: "Generic channel supporting WebSocket, Relay, and Webhook connections.",
  aliases: [],
  order: 100,
} as const;

function resolveGenericAccount(params: { cfg: OpenClawConfig }): ResolvedGenericAccount {
  const { cfg } = params;
  const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled: genericCfg?.enabled ?? false,
    configured: Boolean(genericCfg?.enabled),
  };
}

export const genericPlugin: ChannelPlugin<ResolvedGenericAccount> = {
  id: "clawline",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "genericUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(generic|user):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      await sendMessageGeneric({
        cfg,
        to: id,
        text: PAIRING_APPROVED_MESSAGE,
      });
    },
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,
    threads: false,
    media: true,
    reactions: false,
    edit: false,
    reply: true,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- Generic targeting: omit `target` to reply to the current conversation (auto-inferred). Explicit targets: `user:userId` or `chat:chatId`.",
    ],
  },
  reload: { configPrefixes: ["channels.clawline"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        connectionMode: { type: "string", enum: ["websocket", "webhook", "relay"] },
        wsPort: { type: "integer", minimum: 1 },
        wsPath: { type: "string" },
        auth: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            tokenParam: { type: "string" },
            users: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  senderId: { type: "string" },
                  chatId: { type: "string" },
                  token: { type: "string" },
                  allowAgents: { type: "array", items: { type: "string" } },
                  enabled: { type: "boolean" },
                },
              },
            },
          },
        },
        webhookPath: { type: "string" },
        webhookPort: { type: "integer", minimum: 1 },
        webhookSecret: { type: "string" },
        relay: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string" },
            channelId: { type: "string" },
            secret: { type: "string" },
            instanceId: { type: "string" },
            reconnectIntervalMs: { type: "integer", minimum: 1 },
            connectTimeoutMs: { type: "integer", minimum: 1 },
          },
        },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { type: "string" } },
        historyLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
      },
    },
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => resolveGenericAccount({ cfg }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "clawline": {
          ...cfg.channels?.["clawline"],
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg } as OpenClawConfig;
      const nextChannels = { ...cfg.channels };
      delete (nextChannels as Record<string, unknown>)["clawline"];
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (_account, cfg) => {
      const genericCfg = cfg.channels?.["clawline"] as GenericChannelConfig | undefined;
      return Boolean(genericCfg?.enabled);
    },
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg }) =>
      (cfg.channels?.["clawline"] as GenericChannelConfig | undefined)?.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: () => {
      return [];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        "clawline": {
          ...cfg.channels?.["clawline"],
          enabled: true,
        },
      },
    }),
  },
  messaging: {
    normalizeTarget: (target) => {
      if (target.startsWith("user:") || target.startsWith("chat:")) {
        return target;
      }
      return `user:${target}`;
    },
    targetResolver: {
      looksLikeId: (id) => {
        return /^(user|chat):.+/.test(id) || /^[a-zA-Z0-9_-]+$/.test(id);
      },
      hint: "<userId|user:userId|chat:chatId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
    listPeersLive: async () => [],
    listGroupsLive: async () => [],
  },
  outbound: genericOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      port: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg }) =>
      await probeGeneric(cfg.channels?.["clawline"] as GenericChannelConfig | undefined),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { monitorGenericProvider } = await import("./monitor.js");
      const genericCfg = ctx.cfg.channels?.["clawline"] as GenericChannelConfig | undefined;
      const port =
        genericCfg?.connectionMode === "websocket"
          ? genericCfg?.wsPort ?? 8080
          : genericCfg?.connectionMode === "webhook"
            ? genericCfg?.webhookPort ?? 3000
            : null;
      ctx.setStatus({ accountId: ctx.accountId, port });
      ctx.log?.info(`starting generic provider (mode: ${genericCfg?.connectionMode ?? "websocket"})`);
      return monitorGenericProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
};
