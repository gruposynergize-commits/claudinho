"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api, type ApiError } from "@/lib/api-client";

/** Executa uma ação do painel e atualiza os dados do servidor ao concluir. */
export function useAdminAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function run<T = unknown>(url: string, body: unknown, method = "POST"): Promise<T | null> {
    setBusy(true);
    setError(null);
    const r = await api<T>(url, { method, body });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    router.refresh();
    return r.data;
  }
  return { run, busy, error, setError };
}

export function ErrorBox({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const fields = error.details?.fields ? Object.entries(error.details.fields) : [];
  return (
    <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
      <p>{error.message}</p>
      {fields.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {fields.map(([k, v]) => (
            <li key={k}>
              <code>{k}</code>: {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Diálogo de confirmação acessível (<dialog> nativo). O conteúdo recebe
 * `close` para fechar após sucesso.
 */
export function Dialog({
  trigger,
  title,
  children,
  triggerClassName = "btn-secondary",
  disabled,
}: {
  trigger: React.ReactNode;
  title: string;
  children: (close: () => void) => React.ReactNode;
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)} disabled={disabled}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 backdrop:bg-black/50"
      >
        {open && (
          <div className="space-y-4 p-5">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            {children(() => setOpen(false))}
          </div>
        )}
      </dialog>
    </>
  );
}

/** Formulário de filtros GET que envia sozinho após digitação (debounce). */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <form
      ref={ref}
      method="get"
      className={className}
      onChange={(e) => {
        const target: EventTarget = e.target;
        if (timer.current) clearTimeout(timer.current);
        const typing = target instanceof HTMLInputElement && ["text", "search", "tel"].includes(target.type);
        const delay = typing ? 450 : 0;
        timer.current = setTimeout(() => ref.current?.requestSubmit(), delay);
      }}
    >
      {children}
    </form>
  );
}

/** Ação simples com motivo obrigatório (cancelar, bloquear, reembolsar...). */
export function ReasonAction({
  label,
  title,
  description,
  url,
  extraBody,
  confirmLabel,
  danger,
  minLength = 5,
  disabled,
}: {
  label: string;
  title: string;
  description: string;
  url: string;
  extraBody?: Record<string, unknown>;
  confirmLabel: string;
  danger?: boolean;
  minLength?: number;
  disabled?: boolean;
}) {
  const { run, busy, error } = useAdminAction();
  const [reason, setReason] = useState("");
  const id = useId();
  return (
    <Dialog trigger={label} title={title} triggerClassName={danger ? "btn-danger" : "btn-secondary"} disabled={disabled}>
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(url, { ...extraBody, reason });
            if (ok !== null) close();
          }}
        >
          <p className="text-sm text-stone-700">{description}</p>
          <div>
            <label className="label" htmlFor={id}>Motivo (fica registrado na auditoria)</label>
            <textarea id={id} className="input py-2" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} minLength={minLength} required />
          </div>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>
              Cancelar
            </button>
            <button type="submit" className={danger ? "btn-danger" : "btn-primary"} disabled={busy || reason.trim().length < minLength}>
              {busy ? "Processando…" : confirmLabel}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
