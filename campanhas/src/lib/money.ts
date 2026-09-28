/**
 * Dinheiro sempre em centavos inteiros (BRL). Nenhuma conta usa ponto
 * flutuante; conversões para decimal acontecem somente na borda (exibição e
 * API do gateway).
 */

export function assertCents(value: number, label = "valor"): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} inválido em centavos: ${value}`);
  }
  return value;
}

/** unitário × quantidade, com checagem de overflow. */
export function multiplyCents(unitCents: number, quantity: number): number {
  assertCents(unitCents, "preço unitário");
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new RangeError(`quantidade inválida: ${quantity}`);
  }
  const total = unitCents * quantity;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("total excede o limite seguro");
  }
  return total;
}

/** 1470 → "14.70" (string, sem ponto flutuante). */
export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  const reais = Math.trunc(cents / 100);
  const centavos = cents % 100;
  return `${reais}.${String(centavos).padStart(2, "0")}`;
}

/** 1470 → 14.7 (número JSON aceito pela API do gateway). */
export function centsToGatewayAmount(cents: number): number {
  return Number(centsToDecimalString(cents));
}

/**
 * Converte valor decimal vindo do gateway (ex.: 14.7 ou "14.70") para
 * centavos. Rejeita valores com mais de 2 casas decimais ou inválidos, em vez
 * de arredondar silenciosamente.
 */
export function gatewayAmountToCents(amount: unknown): number {
  const str = typeof amount === "number" ? amount.toString() : typeof amount === "string" ? amount.trim() : "";
  if (!/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(str)) {
    throw new RangeError(`valor do gateway inválido: ${String(amount)}`);
  }
  const n = Number(str);
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`valor do gateway inválido: ${String(amount)}`);
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    throw new RangeError(`valor do gateway com mais de 2 casas decimais: ${String(amount)}`);
  }
  return assertCents(cents);
}

/** 3430 → "R$ 34,30"; 123456 → "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  assertCents(cents);
  const reais = Math.trunc(cents / 100);
  const centavos = String(cents % 100).padStart(2, "0");
  const withThousands = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$\u00a0${withThousands},${centavos}`;
}

/** "4,90" | "4.90" | "4" → 490. Usado em formulários do painel. */
export function parseBRLToCents(input: string): number {
  const s = input.replace(/\s|R\$/g, "").trim();
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(s)) {
    throw new RangeError("valor em reais inválido");
  }
  const [intPart, decPart = ""] = s.split(/[.,]/);
  return assertCents(Number(intPart) * 100 + Number(decPart.padEnd(2, "0")));
}
