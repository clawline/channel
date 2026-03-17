import { z } from "zod";
export { z };

const DmPolicySchema = z.enum(["open", "pairing", "allowlist"]);
const GenericConnectionModeSchema = z.enum(["websocket", "webhook", "relay"]);
const GenericAuthUserSchema = z
  .object({
    id: z.string().optional(),
    senderId: z.string(),
    chatId: z.string().optional(),
    token: z.string(),
    allowAgents: z.array(z.string()).optional(),
    enabled: z.boolean().optional().default(true),
  })
  .strict();
const GenericAuthConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    tokenParam: z.string().optional().default("token"),
    users: z.array(GenericAuthUserSchema).optional().default([]),
  })
  .strict();
const GenericTranscriptionConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    provider: z.literal("faster-whisper").optional().default("faster-whisper"),
    applyToVoice: z.boolean().optional().default(true),
    applyToAudio: z.boolean().optional().default(true),
    pythonPath: z.string().optional(),
    model: z.string().optional().default("tiny"),
    language: z.string().optional(),
    device: z.string().optional().default("cpu"),
    computeType: z.string().optional().default("int8"),
    timeoutMs: z.number().int().positive().optional().default(120000),
  })
  .strict();
const GenericRelayConfigSchema = z
  .object({
    url: z.string().url(),
    channelId: z.string().min(1),
    secret: z.string().min(1),
    instanceId: z.string().optional(),
    reconnectIntervalMs: z.number().int().positive().optional().default(3000),
    connectTimeoutMs: z.number().int().positive().optional().default(10000),
  })
  .strict();

export const GenericChannelConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(false),

    // Connection mode
    connectionMode: GenericConnectionModeSchema.optional().default("websocket"),

    // WebSocket configuration
    wsPort: z.number().int().positive().optional().default(8080),
    wsPath: z.string().optional().default("/ws"),
    auth: GenericAuthConfigSchema.optional(),

    // Webhook configuration
    webhookPath: z.string().optional().default("/generic/events"),
    webhookPort: z.number().int().positive().optional().default(3000),
    webhookSecret: z.string().optional(),

    // Relay configuration
    relay: GenericRelayConfigSchema.optional(),

    // Message policy
    dmPolicy: DmPolicySchema.optional().default("open"),
    allowFrom: z.array(z.string()).optional(),

    // Message limits
    historyLimit: z.number().int().min(0).optional().default(10),
    textChunkLimit: z.number().int().min(1).optional().default(4000),

    // Media handling
    mediaMaxMb: z.number().positive().optional().default(30),
    transcription: GenericTranscriptionConfigSchema.optional(),
  })
  .strict();
