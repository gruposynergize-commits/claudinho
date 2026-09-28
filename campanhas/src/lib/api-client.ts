/**
 * Cliente HTTP do navegador para as rotas da própria aplicação.
 * Nunca lança exceção: devolve { ok:false, error } com mensagem amigável.
 */

export type ApiError = {
  code: string;
  message: string;
  details?: { fields?: Record<string, string>; unavailable?: number[]; retryAfter?: number; [k: string]: unknown };
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };

const NETWORK_ERROR: ApiError = {
  code: "NETWORK",
  message: "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR, status: 0 };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // resposta sem JSON
  }
  const body = json as { ok?: boolean; data?: T; error?: ApiError } | null;
  if (res.ok && body?.ok) return { ok: true, data: body.data as T };
  return {
    ok: false,
    status: res.status,
    error: body?.error ?? { code: "INTERNAL", message: "Não conseguimos concluir a operação. Tente novamente." },
  };
}

/** Armazenamento local tolerante a falhas (modo privado, bloqueios). */
export const safeStorage = {
  get(kind: "session" | "local", key: string): string | null {
    try {
      return (kind === "session" ? sessionStorage : localStorage).getItem(key);
    } catch {
      return null;
    }
  },
  set(kind: "session" | "local", key: string, value: string): void {
    try {
      (kind === "session" ? sessionStorage : localStorage).setItem(key, value);
    } catch {
      // ignora
    }
  },
  remove(kind: "session" | "local", key: string): void {
    try {
      (kind === "session" ? sessionStorage : localStorage).removeItem(key);
    } catch {
      // ignora
    }
  },
};
