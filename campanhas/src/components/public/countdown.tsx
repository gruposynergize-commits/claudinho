"use client";

import { useEffect, useState } from "react";

/** Contagem regressiva até `until` (ISO). Chama onExpire uma vez ao zerar. */
export function Countdown({ until, onExpire, className }: { until: string; onExpire?: () => void; className?: string }) {
  const target = new Date(until).getTime();
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()));

  useEffect(() => {
    const tick = () => {
      const l = Math.max(0, target - Date.now());
      setLeft(l);
      if (l === 0) {
        clearInterval(id);
        onExpire?.();
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const total = Math.floor(left / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return (
    <span className={className} role="timer" aria-live="off">
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}
