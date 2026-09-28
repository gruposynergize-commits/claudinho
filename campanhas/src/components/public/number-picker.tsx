"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, safeStorage } from "@/lib/api-client";
import { formatBRL } from "@/lib/money";
import { formatNumber } from "@/lib/format";

type Props = {
  slug: string;
  priceCents: number;
  firstNumber: number;
  totalNumbers: number;
  numberDigits: number;
  maxPerOrder: number;
  minPerOrder: number;
};

type NumbersData = { statuses: string; salesOpen: boolean; firstNumber: number; totalNumbers: number };

const PAGE_SIZE = 100;

// Estados visuais (contraste AA; o texto do estado vai no aria-label).
const CELL: Record<string, string> = {
  A: "border-green-600 bg-green-50 text-green-900 hover:bg-green-100",
  R: "border-amber-400 bg-amber-100 text-amber-900",
  P: "border-blue-400 bg-blue-100 text-blue-900",
  S: "border-red-300 bg-red-100 text-red-900 line-through decoration-2",
  X: "border-stone-300 bg-stone-200 text-stone-500 line-through",
};
const STATE_LABEL: Record<string, string> = {
  A: "disponível",
  R: "reservado",
  P: "aguardando pagamento",
  S: "pago",
  X: "indisponível",
};

function randomIndex(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return buf[0]! % max;
}

export function NumberPicker(props: Props) {
  const router = useRouter();
  const storageSel = `sel:${props.slug}`;
  const storageRes = `res:${props.slug}`;

  const [data, setData] = useState<NumbersData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const last = props.firstNumber + props.totalNumbers - 1;
  const pages = Math.ceil(props.totalNumbers / PAGE_SIZE);
  const fmt = useCallback((n: number) => formatNumber(n, props.numberDigits), [props.numberDigits]);

  const load = useCallback(async () => {
    const r = await api<NumbersData>(`/api/public/campaigns/${props.slug}/numbers`);
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else {
      setLoadError(r.error.message);
    }
  }, [props.slug]);

  // Carrega seleção salva e estados; atualiza periodicamente com a aba visível.
  useEffect(() => {
    const saved = safeStorage.get("session", storageSel);
    if (saved) {
      try {
        const arr = JSON.parse(saved) as unknown;
        if (Array.isArray(arr)) setSelected(new Set(arr.filter((n): n is number => Number.isInteger(n))));
      } catch {
        // ignora
      }
    }
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, storageSel]);

  useEffect(() => {
    safeStorage.set("session", storageSel, JSON.stringify([...selected]));
  }, [selected, storageSel]);

  const stateOf = useCallback(
    (n: number): string => data?.statuses[n - props.firstNumber] ?? "A",
    [data, props.firstNumber],
  );

  // Se algum número selecionado deixou de estar disponível, avisa e remove.
  useEffect(() => {
    if (!data) return;
    const lost = [...selected].filter((n) => stateOf(n) !== "A");
    if (lost.length > 0) {
      setSelected((prev) => new Set([...prev].filter((n) => !lost.includes(n))));
      setMessage({ kind: "info", text: `Removemos ${lost.map(fmt).join(", ")}: acabaram de ser escolhidos por outra pessoa.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Busca com debounce: vai para a página do número digitado.
  useEffect(() => {
    const t = setTimeout(() => {
      const n = Number(search.replace(/\D/g, ""));
      if (!search || !Number.isInteger(n) || n < props.firstNumber || n > last) {
        setHighlight(null);
        return;
      }
      setOnlyAvailable(false);
      setPage(Math.floor((n - props.firstNumber) / PAGE_SIZE));
      setHighlight(n);
    }, 250);
    return () => clearTimeout(t);
  }, [search, props.firstNumber, last]);

  const pageNumbers = useMemo(() => {
    const start = props.firstNumber + page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE - 1, last);
    const list: number[] = [];
    for (let n = start; n <= end; n++) {
      if (!onlyAvailable || stateOf(n) === "A" || selected.has(n)) list.push(n);
    }
    return list;
  }, [page, props.firstNumber, last, onlyAvailable, stateOf, selected]);

  const availableCount = useMemo(() => (data ? [...data.statuses].filter((c) => c === "A").length : 0), [data]);

  function toggle(n: number) {
    if (stateOf(n) !== "A") return;
    setMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else {
        if (next.size >= props.maxPerOrder) {
          setMessage({ kind: "error", text: `Você pode escolher até ${props.maxPerOrder} números por pedido.` });
          return prev;
        }
        next.add(n);
      }
      return next;
    });
  }

  function surprise(qty: number) {
    if (!data) return;
    const pool: number[] = [];
    for (let i = 0; i < data.statuses.length; i++) {
      const n = props.firstNumber + i;
      if (data.statuses[i] === "A" && !selected.has(n)) pool.push(n);
    }
    const room = props.maxPerOrder - selected.size;
    const take = Math.min(qty, room, pool.length);
    if (take <= 0) {
      setMessage({ kind: "error", text: room <= 0 ? `Limite de ${props.maxPerOrder} números por pedido.` : "Não há números disponíveis." });
      return;
    }
    const picked = new Set(selected);
    for (let i = 0; i < take; i++) {
      const idx = randomIndex(pool.length);
      picked.add(pool[idx]!);
      pool.splice(idx, 1);
    }
    setSelected(picked);
    setMessage({ kind: "info", text: `${take} número(s) escolhido(s) aleatoriamente.` });
  }

  async function continuar() {
    if (selected.size === 0 || submitting) return;
    if (selected.size < props.minPerOrder) {
      setMessage({ kind: "error", text: `Selecione ao menos ${props.minPerOrder} número(s).` });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const r = await api<{ token: string }>(`/api/public/campaigns/${props.slug}/reservations`, {
      body: { numbers: [...selected].sort((a, b) => a - b), replaceToken: safeStorage.get("session", storageRes) },
    });
    if (r.ok) {
      safeStorage.set("session", storageRes, r.data.token);
      router.push(`/campanha/${props.slug}/checkout`);
      return;
    }
    setSubmitting(false);
    if (r.error.code === "NUMBERS_UNAVAILABLE" && r.error.details?.unavailable) {
      const lost = r.error.details.unavailable;
      setSelected((prev) => new Set([...prev].filter((n) => !lost.includes(n))));
    }
    setMessage({ kind: "error", text: r.error.message });
    void load();
  }

  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const grid = gridRef.current;
    if (!grid) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length || 5;
    const delta: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -9999, End: 9999 };
    const d = delta[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(pageNumbers.length - 1, focusIndex + d));
    setFocusIndex(next);
    grid.querySelectorAll<HTMLButtonElement>("button[data-cell]")[next]?.focus();
  }

  const totalCents = props.priceCents * selected.size;
  const salesOpen = data?.salesOpen ?? true;

  return (
    <div className="pb-40">
      <div className="sticky top-0 z-10 -mx-4 space-y-3 border-b border-stone-200 bg-[#faf7f8]/95 px-4 pb-3 pt-2 backdrop-blur">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="busca">Buscar número</label>
          <input
            id="busca"
            inputMode="numeric"
            placeholder={`Buscar número (ex.: ${fmt(props.firstNumber + 6)})`}
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value.slice(0, props.numberDigits + 2))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 font-medium">
            <input type="checkbox" className="size-5 accent-brand-600" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
            Só disponíveis
          </label>
          <span className="text-stone-600">{data ? `${availableCount.toLocaleString("pt-BR")} disponíveis` : "Carregando…"}</span>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Faixas de números">
          {Array.from({ length: pages }, (_, i) => {
            const start = props.firstNumber + i * PAGE_SIZE;
            const end = Math.min(start + PAGE_SIZE - 1, last);
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setPage(i);
                  setFocusIndex(0);
                }}
                aria-pressed={page === i}
                className={`min-h-11 shrink-0 rounded-xl border px-3 text-sm font-semibold ${
                  page === i ? "border-brand-600 bg-brand-600 text-white" : "border-stone-300 bg-white text-stone-800"
                }`}
              >
                {fmt(start)}–{fmt(end)}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-700" aria-label="Legenda">
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-green-600 bg-green-50" aria-hidden />Disponível</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-amber-400 bg-amber-100" aria-hidden />Reservado</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-blue-400 bg-blue-100" aria-hidden />Aguardando pagamento</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-red-300 bg-red-100" aria-hidden />Pago</li>
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-stone-700">Surpresinha:</span>
        {[1, 5, 10, 20].map((q) => (
          <button key={q} type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => surprise(q)} disabled={!data || !salesOpen}>
            +{q}
          </button>
        ))}
      </div>

      {loadError && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 font-medium text-red-800">
          {loadError}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Tentar de novo
          </button>
        </p>
      )}
      {!salesOpen && (
        <p role="status" className="mt-3 rounded-xl bg-stone-100 px-4 py-3 font-medium text-stone-800">
          As vendas não estão abertas no momento.
        </p>
      )}

      {!data && !loadError ? (
        <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10" aria-hidden>
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-stone-200" />
          ))}
        </div>
      ) : (
        <div
          ref={gridRef}
          role="group"
          aria-label={`Números ${fmt(props.firstNumber + page * PAGE_SIZE)} a ${fmt(Math.min(props.firstNumber + (page + 1) * PAGE_SIZE - 1, last))}`}
          className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10"
          onKeyDown={onGridKey}
        >
          {pageNumbers.map((n, i) => {
            const st = stateOf(n);
            const isSel = selected.has(n);
            const available = st === "A";
            return (
              <button
                key={n}
                data-cell
                type="button"
                tabIndex={i === focusIndex ? 0 : -1}
                onFocus={() => setFocusIndex(i)}
                onClick={() => toggle(n)}
                disabled={!available || !salesOpen}
                aria-pressed={available ? isSel : undefined}
                aria-label={`Número ${fmt(n)}, ${isSel ? "selecionado" : STATE_LABEL[st]}`}
                className={`relative h-14 rounded-xl border-2 font-mono text-base font-bold tabular-nums transition-colors disabled:cursor-not-allowed ${
                  isSel ? "border-green-800 bg-green-700 text-white" : CELL[st]
                } ${highlight === n ? "ring-4 ring-brand-500 ring-offset-2" : ""}`}
              >
                {fmt(n)}
                {isSel && (
                  <span aria-hidden className="absolute right-1 top-0.5 text-xs">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
          {pageNumbers.length === 0 && <p className="col-span-full py-6 text-center text-stone-600">Nenhum número disponível nesta faixa.</p>}
        </div>
      )}

      <div className="mt-4 flex justify-between">
        <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          ← Anterior
        </button>
        <button type="button" className="btn-ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>
          Próxima →
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-3">
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm font-medium ${message.kind === "error" ? "text-red-700" : "text-stone-700"}`}>
              {message.text}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div aria-live="polite">
              <p className="font-bold">Números selecionados: {selected.size}</p>
              <p className="text-sm text-stone-600">
                {formatBRL(props.priceCents)} × {selected.size} = <strong className="text-stone-900">{formatBRL(totalCents)}</strong>
              </p>
            </div>
            {selected.size > 0 && (
              <button type="button" className="text-sm font-semibold text-stone-600 underline" onClick={() => setSelected(new Set())}>
                Limpar
              </button>
            )}
          </div>
          {selected.size > 0 && (
            <p className="line-clamp-2 font-mono text-xs text-stone-600">{[...selected].sort((a, b) => a - b).map(fmt).join(" · ")}</p>
          )}
          <button type="button" className="btn-primary w-full uppercase tracking-wide" disabled={selected.size === 0 || submitting || !salesOpen} onClick={() => void continuar()}>
            {submitting ? "Reservando…" : "Continuar"}
          </button>
          <p className="text-center text-xs text-stone-500">O valor final é calculado pelo sistema com o preço oficial da campanha.</p>
        </div>
      </div>
    </div>
  );
}
