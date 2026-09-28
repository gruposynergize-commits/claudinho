/**
 * Extração de informações de erros do PostgreSQL vindos do Prisma 7
 * (driver adapter `pg`). Formatos observados:
 *  - consultas raw: PrismaClientKnownRequestError P2010 com
 *    meta.driverAdapterError.cause.{originalCode, originalMessage};
 *  - API de modelos: P2039 (trigger/CHECK) ou P2002 (unique);
 *  - falhas no COMMIT (constraints adiadas): DriverAdapterError com .cause.
 */

export type DbErrorInfo = {
  prismaCode?: string;
  pgCode?: string;
  message?: string;
  kind?: string;
  constraint?: string;
  /** Prefixo definido nos RAISE dos triggers (ex.: NUMBER_INVALID_TRANSITION). */
  triggerCode?: string;
};

type Loose = Record<string, unknown>;

function asObj(v: unknown): Loose | undefined {
  return v && typeof v === "object" ? (v as Loose) : undefined;
}

export function dbErrorInfo(e: unknown): DbErrorInfo | null {
  const err = asObj(e);
  if (!err) return null;

  const meta = asObj(err.meta);
  const adapterErr = asObj(meta?.driverAdapterError);
  let cause = asObj(adapterErr?.cause);
  if (!cause && err.name === "DriverAdapterError") cause = asObj(err.cause);

  const prismaCode = typeof err.code === "string" && err.code.startsWith("P2") ? err.code : undefined;

  if (!cause && !prismaCode) return null;

  const pgCode =
    (typeof cause?.originalCode === "string" && cause.originalCode) ||
    (typeof cause?.code === "string" && cause.code) ||
    (prismaCode === "P2002" ? "23505" : undefined) ||
    undefined;
  const message =
    (typeof cause?.originalMessage === "string" && cause.originalMessage) ||
    (typeof cause?.message === "string" && cause.message) ||
    undefined;
  const constraintObj = asObj(cause?.constraint);
  const constraint = typeof constraintObj?.index === "string" ? constraintObj.index : undefined;

  let triggerCode: string | undefined;
  if (pgCode === "P0001" && message) {
    const m = /^([A-Z][A-Z0-9_]+):/.exec(message);
    if (m) triggerCode = m[1];
  }

  return {
    prismaCode,
    pgCode,
    message,
    kind: typeof cause?.kind === "string" ? cause.kind : undefined,
    constraint,
    triggerCode,
  };
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const info = dbErrorInfo(e);
  if (!info || info.pgCode !== "23505") return false;
  return constraint ? info.constraint === constraint : true;
}

export function triggerCodeOf(e: unknown): string | undefined {
  return dbErrorInfo(e)?.triggerCode;
}
