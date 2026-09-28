/**
 * Métodos de apuração — funções puras e determinísticas (exceto CSPRNG, que
 * recebe a fonte aleatória por parâmetro). Nada aqui usa Math.random().
 *
 * Tudo o que é calculado aqui é reproduzível por qualquer pessoa a partir de
 * dados públicos: a lista canônica de números elegíveis (publicada com o
 * hash SHA-256 no congelamento) e a entrada oficial (ex.: resultado da
 * Loteria Federal), definida ANTES de ser conhecida.
 */

export type DrawMethodName = "FEDERAL_LOTTERY" | "VERIFIABLE_HASH" | "CSPRNG";
export type UnsoldRule = "NEXT_HIGHER" | "NEXT_LOWER";

export type FederalParams = { digits: number; unsoldRule: UnsoldRule };

export type Range = { firstNumber: number; totalNumbers: number; numberDigits: number };

export type WinnerComputation = {
  prizePosition: number;
  /** Valor de entrada usado para este prêmio (ex.: "12345"). */
  inputValue: string;
  /** Número derivado antes de aplicar a regra de número não elegível. */
  derivedNumber: number | null;
  winnerNumber: number;
  /** Passo a passo legível e reproduzível. */
  steps: string[];
  /** Dados estruturados do cálculo (gravados em draw_results.computation). */
  data: Record<string, unknown>;
};

export class DrawInputError extends Error {}

/** Formato canônico da lista (o mesmo implementado em draw_canonical_hash no banco). */
export const CANONICAL_FORMAT_DESCRIPTION =
  "Números elegíveis (pagos) em ordem crescente, com zeros à esquerda até a quantidade de dígitos da campanha, " +
  "um por linha, separados por LF (\\n), com LF ao final; texto em UTF-8. Hash: SHA-256 em hexadecimal minúsculo.";

export const CANONICAL_FORMAT_ID = "v1:sorted-asc;zero-pad;lf-separated;trailing-lf;utf-8;sha-256-hex";

export function pad(n: number, digits: number): string {
  return String(n).padStart(digits, "0");
}

/** Texto canônico da lista elegível (a entrada exata do SHA-256). */
export function canonicalList(numbers: readonly number[], digits: number): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) throw new DrawInputError(`Número repetido na lista: ${sorted[i]}`);
  }
  return `${sorted.map((n) => pad(n, digits)).join("\n")}\n`;
}

function assertEligible(eligible: readonly number[], prizes: number): number[] {
  const sorted = [...eligible].sort((a, b) => a - b);
  if (sorted.some((n) => !Number.isSafeInteger(n))) throw new DrawInputError("Lista elegível inválida.");
  if (prizes < 1) throw new DrawInputError("Cadastre ao menos um prêmio.");
  if (sorted.length < prizes) throw new DrawInputError(`Há ${sorted.length} número(s) elegível(is) para ${prizes} prêmio(s).`);
  return sorted;
}

/** Redução ao intervalo da campanha: o próprio número se já estiver nele; senão soma/subtrai o total. */
export function reduceToRange(value: number, range: Range): number {
  const { firstNumber: f, totalNumbers: t } = range;
  return f + ((((value - f) % t) + t) % t);
}

/** Aplica a regra de número não elegível sobre a lista (ordenada) ainda disponível. */
export function applyUnsoldRule(candidate: number, available: readonly number[], rule: UnsoldRule): number {
  if (available.length === 0) throw new DrawInputError("Não há números elegíveis restantes.");
  if (rule === "NEXT_HIGHER") return available.find((n) => n > candidate) ?? available[0]!;
  for (let i = available.length - 1; i >= 0; i--) if (available[i]! < candidate) return available[i]!;
  return available[available.length - 1]!;
}

export function describeFederal(params: FederalParams, range: Range): string {
  const last = range.firstNumber + range.totalNumbers - 1;
  const rule =
    params.unsoldRule === "NEXT_HIGHER"
      ? "o número elegível imediatamente superior (após o último, volta ao primeiro)"
      : "o número elegível imediatamente inferior (antes do primeiro, volta ao último)";
  return (
    `Loteria Federal: para o N-ésimo prêmio da campanha usa-se o N-ésimo prêmio da extração de referência. ` +
    `Tomam-se os ${params.digits} últimos dígitos do número sorteado. Se o valor estiver entre ${pad(range.firstNumber, range.numberDigits)} e ${pad(last, range.numberDigits)}, ` +
    `ele é o número apurado; caso contrário, soma-se ou subtrai-se ${range.totalNumbers} até cair nesse intervalo. ` +
    `Se o número apurado não for elegível (não pago) ou já tiver sido contemplado em prêmio anterior, vence ${rule}.`
  );
}

/** Loteria Federal: normaliza e valida os números informados (apenas dígitos, 5 ou 6). */
export function parseLotteryNumber(raw: string): string {
  const v = raw.replace(/[\s.]/g, "");
  if (!/^\d{5,6}$/.test(v)) throw new DrawInputError(`Resultado inválido: "${raw}". Informe o número completo (5 ou 6 dígitos).`);
  return v;
}

export function computeFederalLottery(input: {
  eligible: readonly number[];
  prizesCount: number;
  lotteryPrizes: readonly string[];
  params: FederalParams;
  range: Range;
}): WinnerComputation[] {
  const { params, range } = input;
  const available = assertEligible(input.eligible, input.prizesCount);
  if (input.prizesCount > 5) throw new DrawInputError("A Loteria Federal tem 5 prêmios: use até 5 prêmios na campanha.");
  if (input.lotteryPrizes.length < input.prizesCount) {
    throw new DrawInputError(`Informe o resultado dos ${input.prizesCount} primeiros prêmios da Loteria Federal.`);
  }
  if (!Number.isInteger(params.digits) || params.digits < 1 || params.digits > 6) throw new DrawInputError("Quantidade de dígitos inválida.");

  const results: WinnerComputation[] = [];
  for (let i = 0; i < input.prizesCount; i++) {
    const raw = parseLotteryNumber(input.lotteryPrizes[i]!);
    if (params.digits > raw.length) throw new DrawInputError(`O ${i + 1}º prêmio tem menos de ${params.digits} dígitos.`);
    const usedDigits = raw.slice(-params.digits);
    const value = Number(usedDigits);
    const derived = reduceToRange(value, range);
    const steps = [
      `${i + 1}º prêmio da Loteria Federal: ${raw}`,
      `${params.digits} últimos dígitos: ${usedDigits} → ${value}`,
      derived === value ? `Dentro do intervalo da campanha: ${pad(derived, range.numberDigits)}` : `Reduzido ao intervalo da campanha: ${pad(derived, range.numberDigits)}`,
    ];
    let winner = derived;
    let ruleApplied = false;
    if (!available.includes(derived)) {
      winner = applyUnsoldRule(derived, available, params.unsoldRule);
      ruleApplied = true;
      steps.push(
        `${pad(derived, range.numberDigits)} não é elegível ou já foi contemplado → regra ${params.unsoldRule === "NEXT_HIGHER" ? "superior" : "inferior"}: ${pad(winner, range.numberDigits)}`,
      );
    }
    steps.push(`Número vencedor: ${pad(winner, range.numberDigits)}`);
    available.splice(available.indexOf(winner), 1);
    results.push({
      prizePosition: i + 1,
      inputValue: raw,
      derivedNumber: derived,
      winnerNumber: winner,
      steps,
      data: { method: "FEDERAL_LOTTERY", lotteryPrize: i + 1, raw, usedDigits, value, derived, ruleApplied, unsoldRule: params.unsoldRule, winner },
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Hash verificável
// ---------------------------------------------------------------------------

const TWO_256 = BigInt(2) ** BigInt(256);

export function describeVerifiableHash(): string {
  return (
    "Hash verificável: para cada prêmio k (1, 2, …) calcula-se SHA-256 do texto " +
    '"<hash da lista>|<entrada pública>|<k>|<tentativa>" (tentativa começa em 0). O resultado, lido como inteiro ' +
    "de 256 bits, é aceito se for menor que o maior múltiplo de N abaixo de 2^256 (N = números elegíveis ainda não " +
    "contemplados); senão, incrementa-se a tentativa (evita viés). O índice é esse inteiro módulo N na lista em ordem crescente."
  );
}

/** Normalização da entrada pública: espaços nas pontas removidos e espaços internos únicos. */
export function normalizePublicInput(raw: string): string {
  const v = raw.trim().replace(/\s+/g, " ");
  if (v.length < 3 || v.length > 500) throw new DrawInputError("Informe a entrada pública (3 a 500 caracteres).");
  return v;
}

export function computeVerifiableHash(input: {
  eligible: readonly number[];
  prizesCount: number;
  snapshotHash: string;
  publicInput: string;
  numberDigits: number;
  sha256Hex: (text: string) => string;
}): WinnerComputation[] {
  const available = assertEligible(input.eligible, input.prizesCount);
  if (!/^[0-9a-f]{64}$/.test(input.snapshotHash)) throw new DrawInputError("Hash do snapshot inválido.");
  const publicInput = normalizePublicInput(input.publicInput);
  const results: WinnerComputation[] = [];
  for (let k = 1; k <= input.prizesCount; k++) {
    const n = BigInt(available.length);
    const limit = (TWO_256 / n) * n;
    const rejected: string[] = [];
    for (let attempt = 0; ; attempt++) {
      if (attempt > 1000) throw new DrawInputError("Falha inesperada na derivação (tentativas esgotadas).");
      const seed = `${input.snapshotHash}|${publicInput}|${k}|${attempt}`;
      const digest = input.sha256Hex(seed);
      const x = BigInt(`0x${digest}`);
      if (x >= limit) {
        rejected.push(digest);
        continue;
      }
      const index = Number(x % n);
      const winner = available[index]!;
      results.push({
        prizePosition: k,
        inputValue: publicInput,
        derivedNumber: null,
        winnerNumber: winner,
        steps: [
          `Texto: ${seed}`,
          `SHA-256: ${digest}`,
          `N = ${available.length} números elegíveis restantes; índice = inteiro mod N = ${index}`,
          `Número vencedor: ${pad(winner, input.numberDigits)}`,
        ],
        data: { method: "VERIFIABLE_HASH", seed, digest, attempt, rejected, n: available.length, index, winner },
      });
      available.splice(index, 1);
      break;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// CSPRNG
// ---------------------------------------------------------------------------

export function describeCsprng(): string {
  return (
    "CSPRNG: gerador criptograficamente seguro do servidor (node:crypto.randomInt), sem viés, sobre a lista elegível " +
    "em ordem crescente, excluindo números já contemplados. O resultado é registrado em auditoria, mas não pode ser " +
    "recalculado por terceiros — prefira Loteria Federal ou hash verificável quando a transparência pública for essencial."
  );
}

export function computeCsprng(input: {
  eligible: readonly number[];
  prizesCount: number;
  numberDigits: number;
  randomInt: (maxExclusive: number) => number;
}): WinnerComputation[] {
  const available = assertEligible(input.eligible, input.prizesCount);
  const results: WinnerComputation[] = [];
  for (let k = 1; k <= input.prizesCount; k++) {
    const n = available.length;
    const index = input.randomInt(n);
    if (!Number.isInteger(index) || index < 0 || index >= n) throw new DrawInputError("Fonte aleatória inválida.");
    const winner = available[index]!;
    results.push({
      prizePosition: k,
      inputValue: `csprng:index=${index};n=${n}`,
      derivedNumber: null,
      winnerNumber: winner,
      steps: [`N = ${n} números elegíveis restantes`, `Índice sorteado (CSPRNG): ${index}`, `Número vencedor: ${pad(winner, input.numberDigits)}`],
      data: { method: "CSPRNG", n, index, winner },
    });
    available.splice(index, 1);
  }
  return results;
}
