/**
 * Contrato interno de um gateway de cobrança Pix. A implementação atual é o
 * Mercado Pago (payments/gateway/mercadopago.ts); outro provedor pode ser
 * adicionado implementando esta interface.
 */

/** Estado normalizado do pagamento no gateway. */
export type GatewayStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REFUNDED" | "CHARGED_BACK";

export type GatewayPayment = {
  id: string;
  status: GatewayStatus;
  rawStatus: string;
  statusDetail: string | null;
  externalReference: string | null;
  /** Valor da cobrança (centavos). */
  amountCents: number;
  /** Valor pago informado pelo gateway (centavos), quando houver. */
  paidAmountCents: number | null;
  currency: string | null;
  approvedAt: Date | null;
  expiresAt: Date | null;
  /** Pix copia e cola (BR Code dinâmico). */
  qrCode: string | null;
  ticketUrl: string | null;
  paymentMethodId: string | null;
  liveMode: boolean | null;
};

export type CreatePixChargeInput = {
  idempotencyKey: string;
  amountCents: number;
  description: string;
  externalReference: string;
  expiresAt: Date;
  notificationUrl: string | null;
  payer: { email: string; firstName: string; lastName: string; cpf?: string | null };
  metadata?: Record<string, string>;
};

export interface PixGatewayClient {
  readonly name: "MERCADO_PAGO";
  createPixCharge(input: CreatePixChargeInput): Promise<GatewayPayment>;
  getPayment(id: string): Promise<GatewayPayment>;
  searchByExternalReference(externalReference: string): Promise<GatewayPayment[]>;
  /** Cancela cobrança pendente. Falha (GatewayError) se já estiver aprovada. */
  cancelPayment(id: string, idempotencyKey: string): Promise<GatewayPayment>;
}

export type GatewayErrorKind = "network" | "timeout" | "http" | "invalid_response" | "not_configured";

export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly httpStatus?: number;
  readonly responseSnippet?: string;

  constructor(kind: GatewayErrorKind, message: string, opts: { httpStatus?: number; responseSnippet?: string; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "GatewayError";
    this.kind = kind;
    this.httpStatus = opts.httpStatus;
    this.responseSnippet = opts.responseSnippet;
  }

  /** Vale tentar de novo mais tarde (rede, timeout, 429, 5xx). */
  get retryable(): boolean {
    if (this.kind === "network" || this.kind === "timeout" || this.kind === "invalid_response") return true;
    if (this.kind === "http" && this.httpStatus !== undefined) {
      return this.httpStatus === 429 || this.httpStatus >= 500 || this.httpStatus === 408;
    }
    return false;
  }

  /** Rejeição definitiva dos dados enviados (não adianta repetir). */
  get isClientDataError(): boolean {
    return this.kind === "http" && (this.httpStatus === 400 || this.httpStatus === 422);
  }
}
