/**
 * Erro de domínio com mensagem segura para o usuário final.
 * Detalhes técnicos ficam em `internal` e vão apenas para o log do servidor.
 */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CSRF"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "NUMBERS_UNAVAILABLE"
  | "CAMPAIGN_NOT_ACTIVE"
  | "RESERVATION_EXPIRED"
  | "LIMIT_EXCEEDED"
  | "INVALID_STATE"
  | "GATEWAY_UNAVAILABLE"
  | "GATEWAY_NOT_CONFIGURED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF: 403,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  NUMBERS_UNAVAILABLE: 409,
  CAMPAIGN_NOT_ACTIVE: 409,
  RESERVATION_EXPIRED: 410,
  LIMIT_EXCEEDED: 422,
  INVALID_STATE: 409,
  GATEWAY_UNAVAILABLE: 503,
  GATEWAY_NOT_CONFIGURED: 503,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly userMessage: string;
  /** Dados seguros para devolver ao cliente (ex.: números indisponíveis). */
  readonly details?: Record<string, unknown>;
  /** Contexto técnico apenas para log. */
  readonly internal?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    userMessage: string,
    opts: {
      status?: number;
      details?: Record<string, unknown>;
      internal?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(`${code}: ${userMessage}`, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code];
    this.userMessage = userMessage;
    this.details = opts.details;
    this.internal = opts.internal;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export const GENERIC_ERROR_MESSAGE = "Não conseguimos concluir a operação. Tente novamente.";
