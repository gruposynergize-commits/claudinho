/** Rótulos em português para estados exibidos nas telas. */

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Em preparação",
  ACTIVE: "Vendas abertas",
  PAUSED: "Vendas pausadas",
  CLOSED: "Vendas encerradas",
  FROZEN: "Sorteio em preparação",
  DRAWN: "Sorteio realizado",
  CANCELLED: "Campanha cancelada",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Aguardando pagamento",
  PAID: "Pago",
  EXPIRED: "Expirado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  ERROR: "Não concluído",
};

export const NUMBER_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Disponível",
  RESERVED: "Reservado",
  PENDING_PAYMENT: "Aguardando pagamento",
  PAID: "Pago",
  CANCELLED: "Indisponível",
  DRAWN: "Sorteado",
  WINNER: "Vencedor",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  CREATING: "Gerando cobrança",
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  AMOUNT_MISMATCH: "Valor divergente",
  REJECTED: "Recusado",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
  REFUNDED: "Reembolsado",
  CHARGED_BACK: "Contestação (chargeback)",
  FAILED: "Falhou",
};

export const PRIZE_ORIGIN_LABEL: Record<string, string> = {
  NOT_INFORMED: "Origem não informada",
  DONATION: "Doação",
  PURCHASED: "Adquirido pela organização",
  SPONSORSHIP: "Patrocínio",
  OTHER: "Outra origem",
};

export const DRAW_METHOD_LABEL: Record<string, string> = {
  FEDERAL_LOTTERY: "Loteria Federal (regra de derivação documentada)",
  VERIFIABLE_HASH: "Sorteio verificável por hash (referência pública)",
  CSPRNG: "Sorteio eletrônico com gerador criptográfico",
};

export const DELIVERY_STATUS_LABEL: Record<string, string> = {
  PENDING_CONTACT: "Aguardando contato",
  CONTACTED: "Contatado",
  DELIVERED: "Entregue",
  FAILED: "Falha na entrega",
};

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  OPERATOR: "Operador",
  VIEWER: "Somente leitura",
};
