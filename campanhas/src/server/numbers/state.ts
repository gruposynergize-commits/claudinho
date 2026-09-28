import type { CampaignStatus, NumberStatus, OrderStatus } from "@/generated/prisma/client";

/**
 * Espelho das máquinas de estado aplicadas pelos triggers do banco
 * (migração `integrity`). A aplicação consulta estas tabelas antes de tentar
 * uma operação; o banco rejeita qualquer transição fora delas mesmo que a
 * aplicação erre. Testes garantem que as duas definições coincidem.
 */

export type TransitionKind = "normal" | "exceptional" | "draw";

export const NUMBER_TRANSITIONS: Record<string, TransitionKind> = {
  "AVAILABLE>RESERVED": "normal",
  "AVAILABLE>PENDING_PAYMENT": "normal",
  "RESERVED>AVAILABLE": "normal",
  "RESERVED>PENDING_PAYMENT": "normal",
  "PENDING_PAYMENT>PAID": "normal",
  "PENDING_PAYMENT>AVAILABLE": "normal",
  "AVAILABLE>CANCELLED": "exceptional",
  "CANCELLED>AVAILABLE": "exceptional",
  "PAID>CANCELLED": "exceptional",
  "PAID>DRAWN": "draw",
  "DRAWN>WINNER": "draw",
};

export const ORDER_TRANSITIONS: Record<string, TransitionKind> = {
  "PENDING_PAYMENT>PAID": "normal",
  "PENDING_PAYMENT>EXPIRED": "normal",
  "PENDING_PAYMENT>CANCELLED": "normal",
  "PENDING_PAYMENT>ERROR": "normal",
  // Pagamento tardio: só se todos os números ainda estiverem livres.
  "EXPIRED>PAID": "normal",
  "CANCELLED>PAID": "normal",
  "ERROR>PAID": "normal",
  "ERROR>CANCELLED": "normal",
  "PAID>REFUNDED": "exceptional",
};

export const CAMPAIGN_TRANSITIONS: Record<string, TransitionKind> = {
  "DRAFT>ACTIVE": "normal",
  "ACTIVE>PAUSED": "normal",
  "PAUSED>ACTIVE": "normal",
  "ACTIVE>CLOSED": "normal",
  "PAUSED>CLOSED": "normal",
  "CLOSED>ACTIVE": "normal",
  "CLOSED>FROZEN": "normal",
  "FROZEN>DRAWN": "normal",
  "DRAFT>CANCELLED": "normal",
  "ACTIVE>CANCELLED": "normal",
  "PAUSED>CANCELLED": "normal",
  "CLOSED>CANCELLED": "normal",
};

export function numberTransition(from: NumberStatus, to: NumberStatus): TransitionKind | null {
  return NUMBER_TRANSITIONS[`${from}>${to}`] ?? null;
}

export function orderTransition(from: OrderStatus, to: OrderStatus): TransitionKind | null {
  return ORDER_TRANSITIONS[`${from}>${to}`] ?? null;
}

export function campaignTransition(from: CampaignStatus, to: CampaignStatus): TransitionKind | null {
  return CAMPAIGN_TRANSITIONS[`${from}>${to}`] ?? null;
}
