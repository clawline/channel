import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GenericChannelConfig, InboundMessage } from "./types.js";
import type { MediaInfo } from "./media.js";

const FASTER_WHISPER_SCRIPT_PATH = fileURLToPath(
  new URL("./faster-whisper-transcribe.py", import.meta.url),
);
const loggedTranscriptionWarnings = new Set<string>();

type GenericTranscriptionResult = {
  provider: "faster-whisper";
  text: string;
  language?: string;
  languageProbability?: number;
  mediaType: "voice" | "audio";
  model: string;
};

type CompletedProcess = {
  stdout: string;
  stderr: string;
};

type CompletedProcessError = Error & {
  code?: string | number | null;
  stdout?: string;
  stderr?: string;
};

function logWarningOnce(log: ((msg: string) => void) | undefined, key: string, message: string): void {
  if (loggedTranscriptionWarnings.has(key)) {
    return;
  }
  loggedTranscriptionWarnings.add(key);
  log?.(message);
}

function shouldAutoTranscribe(
  cfg: GenericChannelConfig | undefined,
  messageType: InboundMessage["messageType"],
): messageType is "voice" | "audio" {
  const transcription = cfg?.transcription;
  if (!transcription?.enabled) {
    return false;
  }
  if (messageType === "voice") {
    return transcription.applyToVoice !== false;
  }
  if (messageType === "audio") {
    return transcription.applyToAudio !== false;
  }
  return false;
}

function resolvePythonCandidates(cfg: GenericChannelConfig | undefined): string[] {
  const configured = cfg?.transcription?.pythonPath?.trim();
  const env = process.env.GENERIC_CHANNEL_TRANSCRIBE_PYTHON?.trim();
  const homeDir = process.env.HOME?.trim();
  const homeVenv = homeDir ? join(homeDir, ".openclaw", "workspace", ".venv", "bin", "python") : "";
  const candidates = [configured, env, homeVenv, "python3", "python"];
  const seen = new Set<string>();

  return candidates.filter((candidate): candidate is string => {
    const trimmed = candidate?.trim();
    if (!trimmed || seen.has(trimmed)) {
      return false;
    }
    seen.add(trimmed);
    return true;
  });
}

async function shouldAttemptPythonCandidate(candidate: string): Promise<boolean> {
  if (!candidate.includes("/")) {
    return true;
  }

  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function shouldTryNextCandidate(err: CompletedProcessError): boolean {
  const detail = `${err.message}\n${err.stderr ?? ""}\n${err.stdout ?? ""}`.toLowerCase();
  return (
    err.code === "ENOENT" ||
    detail.includes("no module named 'faster_whisper'") ||
    detail.includes('no module named "faster_whisper"') ||
    detail.includes("no module named faster_whisper")
  );
}

function parseTranscriptionOutput(stdout: string): {
  text?: string;
  language?: string;
  languageProbability?: number;
} {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error(`Transcription output did not contain JSON: ${stdout}`);
  }
  const parsed = JSON.parse(jsonLine) as {
    text?: string;
    language?: string;
    languageProbability?: number;
  };
  return parsed;
}

function runCommand(params: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<CompletedProcess> {
  const { command, args, timeoutMs } = params;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const finishError = (err: CompletedProcessError) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      reject(err);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      const err = new Error(
        `Transcription timed out after ${timeoutMs}ms while running ${command}`,
      ) as CompletedProcessError;
      err.code = "ETIMEDOUT";
      err.stdout = stdout;
      err.stderr = stderr;
      finishError(err);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (cause) => {
      const err = new Error(
        `Failed to start transcription command ${command}: ${String(cause)}`,
      ) as CompletedProcessError;
      err.code = (cause as NodeJS.ErrnoException).code ?? null;
      err.stdout = stdout;
      err.stderr = stderr;
      finishError(err);
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const err = new Error(
          `Transcription command exited with code ${String(code)}: ${stderr || stdout || "(no output)"}`,
        ) as CompletedProcessError;
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

export function formatGenericTranscriptionBlock(
  result: GenericTranscriptionResult | null,
): string {
  if (!result?.text.trim()) {
    return "";
  }

  const label = result.mediaType === "voice" ? "Voice transcript" : "Audio transcript";
  return `[${label}]\n${result.text.trim()}`;
}

export async function maybeTranscribeGenericAudio(params: {
  cfg: GenericChannelConfig | undefined;
  messageType: InboundMessage["messageType"];
  mediaList: MediaInfo[];
  log?: (msg: string) => void;
}): Promise<GenericTranscriptionResult | null> {
  const { cfg, messageType, mediaList, log } = params;

  if (!shouldAutoTranscribe(cfg, messageType)) {
    return null;
  }

  const audioMedia =
    mediaList.find((media) => media.contentType?.toLowerCase().startsWith("audio/")) ?? mediaList[0];
  if (!audioMedia?.path) {
    return null;
  }

  const transcription = cfg?.transcription;
  const model = transcription?.model?.trim() || "tiny";
  const timeoutMs = transcription?.timeoutMs ?? 120000;
  const candidates = resolvePythonCandidates(cfg);

  let lastError: CompletedProcessError | null = null;
  for (const candidate of candidates) {
    if (!(await shouldAttemptPythonCandidate(candidate))) {
      continue;
    }

    try {
      const args = [
        FASTER_WHISPER_SCRIPT_PATH,
        "--audio-path",
        audioMedia.path,
        "--model",
        model,
        "--device",
        transcription?.device?.trim() || "cpu",
        "--compute-type",
        transcription?.computeType?.trim() || "int8",
      ];
      if (transcription?.language?.trim()) {
        args.push("--language", transcription.language.trim());
      }

      const completed = await runCommand({
        command: candidate,
        args,
        timeoutMs,
      });
      const parsed = parseTranscriptionOutput(completed.stdout);
      const text = parsed.text?.trim();
      if (!text) {
        log?.(`generic: transcription completed but returned empty text for ${audioMedia.path}`);
        return null;
      }

      log?.(
        `generic: transcribed ${messageType} with faster-whisper` +
          (parsed.language ? ` (lang=${parsed.language})` : "") +
          `, chars=${text.length}`,
      );

      return {
        provider: "faster-whisper",
        text,
        language: parsed.language,
        languageProbability: parsed.languageProbability,
        mediaType: messageType,
        model,
      };
    } catch (err) {
      lastError = err as CompletedProcessError;
      if (shouldTryNextCandidate(lastError)) {
        continue;
      }
      break;
    }
  }

  const detail = lastError
    ? `${lastError.message}${lastError.stderr ? ` :: ${lastError.stderr.trim()}` : ""}`
    : "no usable python runtime found";
  logWarningOnce(
    log,
    `transcription:${messageType}`,
    `generic: automatic ${messageType} transcription unavailable (${detail})`,
  );
  return null;
}
