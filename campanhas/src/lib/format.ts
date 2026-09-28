/** Formatações compartilhadas entre servidor e navegador. */

export const TIME_ZONE = "America/Sao_Paulo";

/** 7 → "0007" (conforme dígitos da campanha). */
export function formatNumber(n: number, digits: number): string {
  return String(n).padStart(digits, "0");
}

export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, dateStyle: "short" }).format(new Date(d));
}

export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(d));
}

/** Data no fuso de Brasília como AAAAMMDD (usada no código do pedido). */
export function yyyymmdd(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** Apenas dígitos. */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Normaliza telefone brasileiro para dígitos com DDI 55.
 * Aceita "(41) 99999-8888", "+55 41 99999-8888", "41999998888".
 * Retorna null se não for um celular/fixo brasileiro plausível.
 */
export function normalizeBrazilPhone(input: string): string | null {
  let d = digitsOnly(input);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55[1-9][0-9]\d{8,9}$/.test(d)) return null;
  const local = d.slice(4);
  // Celular com 9 dígitos precisa começar com 9.
  if (local.length === 9 && !local.startsWith("9")) return null;
  return d;
}

/** "5541999998888" → "(41) 99999-8888" */
export function formatPhone(phone: string): string {
  const d = digitsOnly(phone);
  const local = d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

/** "5541999998888" → "(41) *****-8888" — para telas com PII mascarada. */
export function maskPhone(phone: string): string {
  const d = digitsOnly(phone);
  if (d.length < 4) return "****";
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return `(${local.slice(0, 2)}) *****-${local.slice(-4)}`;
}

/** "maria.silva@gmail.com" → "m***@gmail.com" */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "***";
  return `${user[0]}***@${domain}`;
}

/** "Maria da Silva Souza" → "Maria S." */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]! : "";
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first;
}

/** Validação de CPF (dígitos verificadores). */
export function isValidCpf(input: string): boolean {
  const cpf = digitsOnly(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

/** "12345678909" → "***.***.789-09" */
export function maskCpf(cpf: string): string {
  const d = digitsOnly(cpf);
  if (d.length !== 11) return "***";
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
}
