"use client";

import { useEffect, useId, useRef, useState } from "react";

/*
 * Gráficos do painel (SVG próprio, sem biblioteca). Especificação:
 * - série única em azul #2a78d6 (sem caixa de legenda: o título nomeia a série);
 * - barras ≤ 24 px, ponta de 4 px arredondada e base reta; linha de 2 px;
 * - grade em linha fina 1 px sólida (#e1e0d9); rótulos em tinta de texto;
 * - tooltip no hover e no foco do teclado; visão em tabela sempre disponível.
 * Paleta de estados validada com o script do guia de visualização
 * (#e34948, #2a78d6, #eda100, #008300 sobre #ffffff: todas as checagens OK;
 * amarelo < 3:1 → legenda com valores + tabela).
 */

const SERIES = "#2a78d6";
const GRID = "#e1e0d9";
const BASELINE = "#c3c2b7";
const INK_2 = "#52514e";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function niceTicks(max: number, count = 4, integer = true): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  if (integer) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/** Barra vertical com ponta arredondada (4 px) e base reta. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

type Tip = { x: number; y: number; title: string; value: string } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm shadow-md"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      <p className="font-bold text-stone-900">{tip.value}</p>
      <p className="text-stone-600">{tip.title}</p>
    </div>
  );
}

function TableView({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-semibold text-brand-700">Ver tabela</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className="border-b border-stone-200 px-2 py-1 font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-stone-100">
                {r.map((cell, j) => (
                  <td key={j} className="px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export type Point = { label: string; value: number };

/** Colunas por dia (magnitude ao longo do tempo, série única). */
export function ColumnChart({
  title,
  data,
  format,
  integer = true,
}: {
  title: string;
  data: Point[];
  format: (v: number) => string;
  integer?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const titleId = useId();
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 28, left: 56 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.value), 0);
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1] || 1;
  const slot = data.length > 0 ? innerW / data.length : 0;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const every = Math.max(1, Math.ceil((data.length * 48) / Math.max(innerW, 1)));
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;

  return (
    <figure className="card" aria-labelledby={titleId}>
      <figcaption id={titleId} className="font-bold">
        {title}
      </figcaption>
      <div ref={ref} className="relative mt-3" onPointerLeave={() => setTip(null)}>
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-500">Ainda não há vendas confirmadas.</p>
        ) : (
          width > 0 && (
            <svg width={width} height={height} role="img" aria-label={`${title}: ${data.length} dias`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASELINE : GRID} strokeWidth={1} />
                  <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK_2} className="tabular-nums">
                    {format(t)}
                  </text>
                </g>
              ))}
              {data.map((d, i) => {
                const x = pad.left + i * slot + (slot - barW) / 2;
                const h = (d.value / top) * innerH;
                const show = () => setTip({ x: x + barW / 2, y: y(d.value), title: d.label, value: format(d.value) });
                return (
                  <g key={d.label}>
                    <path d={barPath(x, y(d.value), barW, h)} fill={SERIES} />
                    {/* Alvo de hover/foco maior que a barra. */}
                    <rect
                      x={pad.left + i * slot}
                      y={pad.top}
                      width={Math.max(slot, 1)}
                      height={innerH}
                      fill="transparent"
                      tabIndex={0}
                      aria-label={`${d.label}: ${format(d.value)}`}
                      onPointerEnter={show}
                      onFocus={show}
                      onBlur={() => setTip(null)}
                    />
                    {i % every === 0 && (
                      <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={INK_2}>
                        {d.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )
        )}
        <Tooltip tip={tip} />
      </div>
      <TableView caption={title} columns={["Dia", "Valor"]} rows={data.map((d) => [d.label, format(d.value)])} />
    </figure>
  );
}

/** Evolução acumulada até a meta (ex.: 1.200 números). */
export function CumulativeChart({
  title,
  data,
  target,
  format,
}: {
  title: string;
  data: Point[];
  target: number;
  format: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const height = 220;
  const pad = { top: 16, right: 44, bottom: 28, left: 56 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const ticks = niceTicks(target, 4);
  const top = Math.max(ticks[ticks.length - 1] ?? target, target);
  const n = data.length;
  const x = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join("");
  const area = n > 0 ? `${line}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const last = data[n - 1];
  const every = Math.max(1, Math.ceil((n * 48) / Math.max(innerW, 1)));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const h = hover !== null ? data[hover] : null;
  return (
    <figure className="card" aria-labelledby={titleId}>
      <figcaption id={titleId} className="font-bold">
        {title}
      </figcaption>
      <div ref={ref} className="relative mt-3">
        {n === 0 ? (
          <p className="py-10 text-center text-sm text-stone-500">Ainda não há vendas confirmadas.</p>
        ) : (
          width > 0 && (
            <svg width={width} height={height} role="img" aria-label={`${title}: ${last ? format(last.value) : 0} de ${format(target)}`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASELINE : GRID} strokeWidth={1} />
                  <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK_2} className="tabular-nums">
                    {format(t)}
                  </text>
                </g>
              ))}
              <line x1={pad.left} x2={width - pad.right} y1={y(target)} y2={y(target)} stroke={INK_2} strokeWidth={1} />
              <text x={width - pad.right} y={y(target) - 6} textAnchor="end" fontSize={11} fill={INK_2} fontWeight={600}>
                Meta {format(target)}
              </text>
              <path d={area} fill={SERIES} fillOpacity={0.1} />
              <path d={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {last && (
                <>
                  <circle cx={x(n - 1)} cy={y(last.value)} r={6} fill="#ffffff" />
                  <circle cx={x(n - 1)} cy={y(last.value)} r={4} fill={SERIES} />
                  <text x={x(n - 1) + 8} y={y(last.value)} dy="0.32em" fontSize={12} fontWeight={700} fill="#1f1b1d">
                    {format(last.value)}
                  </text>
                </>
              )}
              {data.map((d, i) =>
                i % every === 0 ? (
                  <text key={d.label} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={INK_2}>
                    {d.label}
                  </text>
                ) : null,
              )}
              {h && hover !== null && (
                <>
                  <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke={BASELINE} strokeWidth={1} />
                  <circle cx={x(hover)} cy={y(h.value)} r={6} fill="#ffffff" />
                  <circle cx={x(hover)} cy={y(h.value)} r={4} fill={SERIES} />
                </>
              )}
              <rect
                x={pad.left}
                y={pad.top}
                width={innerW}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label="Use as setas para percorrer os dias"
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(n - 1)}
                onBlur={() => setHover(null)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? n - 1) - 1));
                  if (e.key === "ArrowRight") setHover((v) => Math.min(n - 1, (v ?? 0) + 1));
                }}
              />
            </svg>
          )
        )}
        {h && hover !== null && <Tooltip tip={{ x: x(hover), y: y(h.value), title: h.label, value: `${format(h.value)} de ${format(target)}` }} />}
      </div>
      <TableView caption={title} columns={["Dia", "Acumulado"]} rows={data.map((d) => [d.label, format(d.value)])} />
    </figure>
  );
}

export type Segment = { label: string; value: number; color: string };

/** Parte-do-todo em uma barra horizontal (100%), com legenda e valores. */
export function StackedBar({ title, segments, format }: { title: string; segments: Segment[]; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const titleId = useId();
  const total = segments.reduce((s, x) => s + x.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  const gap = 2;
  const usable = Math.max(0, width - gap * Math.max(0, visible.length - 1));
  // Posição inicial de cada segmento (soma acumulada, calculada sem mutação no render).
  const widths = visible.map((s) => (total > 0 ? (s.value / total) * usable : 0));
  const starts = widths.map((_, i) => widths.slice(0, i).reduce((a, w) => a + w + gap, 0));
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "0%");
  return (
    <figure className="card" aria-labelledby={titleId}>
      <figcaption id={titleId} className="font-bold">
        {title}
      </figcaption>
      <div ref={ref} className="relative mt-4" onPointerLeave={() => setTip(null)}>
        {width > 0 && (
          <svg width={width} height={28} role="img" aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join("; ")}>
            {visible.map((s, i) => {
              const w = widths[i] ?? 0;
              const x = starts[i] ?? 0;
              const first = i === 0;
              const lastSeg = i === visible.length - 1;
              const r = Math.min(4, w / 2);
              const d = `M${x + (first ? r : 0)},0H${x + w - (lastSeg ? r : 0)}${lastSeg ? `Q${x + w},0 ${x + w},${r}V${28 - r}Q${x + w},28 ${x + w - r},28` : `V28`}H${x + (first ? r : 0)}${first ? `Q${x},28 ${x},${28 - r}V${r}Q${x},0 ${x + r},0` : `V0`}Z`;
              const show = () => setTip({ x: x + w / 2, y: 0, title: s.label, value: `${format(s.value)} (${pct(s.value)})` });
              return <path key={s.label} d={d} fill={s.color} tabIndex={0} aria-label={`${s.label}: ${format(s.value)}`} onPointerEnter={show} onFocus={show} onBlur={() => setTip(null)} />;
            })}
          </svg>
        )}
        <Tooltip tip={tip} />
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {segments.map((s) => (
          <li key={s.label} className="flex items-start gap-2">
            <span aria-hidden className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span>
              <span className="text-stone-600">{s.label}</span>
              <br />
              <strong className="text-stone-900">{format(s.value)}</strong> <span className="text-stone-500">({pct(s.value)})</span>
            </span>
          </li>
        ))}
      </ul>
      <TableView caption={title} columns={["Situação", "Quantidade", "%"]} rows={segments.map((s) => [s.label, format(s.value), pct(s.value)])} />
    </figure>
  );
}

/** Barras horizontais de uma série (ex.: pendentes por idade). */
export function HBarList({ title, items, format }: { title: string; items: Point[]; format: (v: number) => string }) {
  const titleId = useId();
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <figure className="card" aria-labelledby={titleId}>
      <figcaption id={titleId} className="font-bold">
        {title}
      </figcaption>
      <ul className="mt-3 space-y-3">
        {items.map((i) => (
          <li key={i.label}>
            <div className="flex justify-between text-sm">
              <span className="text-stone-700">{i.label}</span>
              <strong className="tabular-nums text-stone-900">{format(i.value)}</strong>
            </div>
            <svg width="100%" height={10} aria-hidden className="mt-1 block">
              <rect x={0} y={0} width="100%" height={10} rx={4} fill="#f0efec" />
              {i.value > 0 && <rect x={0} y={0} width={`${(i.value / max) * 100}%`} height={10} rx={4} fill={SERIES} />}
            </svg>
          </li>
        ))}
      </ul>
    </figure>
  );
}
