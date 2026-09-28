import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Hash de senha com scrypt (parâmetros recomendados pela OWASP:
 * N=2^15, r=8, p=3). Formato: scrypt$N$r$p$salt$hash (base64).
 */
const N = 32768;
const R = 8;
const P = 3;
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64!, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash fixo usado quando o e-mail não existe (tempo de resposta semelhante). */
let dummyHash: string | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword(randomBytes(12).toString("hex"));
  await verifyPassword(password, dummyHash);
}

const COMMON = new Set(["123456789012", "senha1234567", "password1234", "qwertyuiop12", "admin1234567"]);

/** Regras mínimas de senha para o painel. Retorna mensagem de erro ou null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "A senha deve ter pelo menos 12 caracteres.";
  if (password.length > 200) return "Senha muito longa.";
  if (COMMON.has(password.toLowerCase())) return "Senha muito comum.";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return "Use pelo menos 3 tipos: minúsculas, maiúsculas, números e símbolos.";
  return null;
}
