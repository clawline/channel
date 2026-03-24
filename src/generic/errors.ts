export enum ErrorCode {
  INVALID_PAYLOAD = "INVALID_PAYLOAD",
  RATE_LIMITED = "RATE_LIMITED",
  UNAUTHORIZED = "UNAUTHORIZED",
  AGENT_NOT_FOUND = "AGENT_NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export type StructuredError = {
  type: "error";
  data: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
};

export function buildError(code: ErrorCode, message: string, details?: unknown): StructuredError {
  return {
    type: "error",
    data: { code, message, ...(details !== undefined ? { details } : {}) },
  };
}
