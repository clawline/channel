import type { GenericChannelConfig, GenericProbeResult } from "./types.js";

export async function probeGeneric(cfg?: GenericChannelConfig): Promise<GenericProbeResult> {
  if (!cfg) {
    return {
      ok: false,
      error: "Generic channel not configured",
    };
  }

  if (!cfg.enabled) {
    return {
      ok: false,
      error: "Generic channel not enabled",
    };
  }

  const mode = cfg.connectionMode ?? "websocket";

  if (mode === "websocket") {
    const port = cfg.wsPort ?? 8080;

    return {
      ok: true,
      mode,
      port,
    };
  }

  if (mode === "relay") {
    return {
      ok: Boolean(cfg.relay?.url && cfg.relay?.channelId && cfg.relay?.secret),
      mode,
      relayUrl: cfg.relay?.url,
      error: cfg.relay?.url && cfg.relay?.channelId && cfg.relay?.secret
        ? undefined
        : "Relay config incomplete",
    };
  }

  {
    const port = cfg.webhookPort ?? 3000;
    return {
      ok: true,
      mode,
      port,
    };
  }
}
