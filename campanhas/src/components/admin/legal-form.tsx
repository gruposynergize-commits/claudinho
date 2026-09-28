"use client";

import { useState } from "react";
import { ErrorBox, useAdminAction } from "./ui";

export type LegalData = {
  operatorName: string;
  entityName: string;
  cnpj: string;
  authorizationNumber: string;
  regulation: string;
  regulationUrl: string;
  startDate: string;
  endDate: string;
  modality: string;
  officialDrawMethod: string;
  additionalInfo: string;
  privacyContact: string;
  showOnPublicPage: boolean;
};

const FIELDS: { k: keyof LegalData; label: string; hint?: string; area?: number; type?: string }[] = [
  { k: "operatorName", label: "Responsável pela operação" },
  { k: "entityName", label: "Entidade responsável" },
  { k: "cnpj", label: "CNPJ" },
  { k: "authorizationNumber", label: "Número de autorização/certificado (quando aplicável)" },
  { k: "modality", label: "Modalidade" },
  { k: "startDate", label: "Data de início", type: "date" },
  { k: "endDate", label: "Data de encerramento", type: "date" },
  { k: "officialDrawMethod", label: "Método oficial de apuração", area: 3, hint: "Texto exibido ao público; deve corresponder ao regulamento." },
  { k: "regulationUrl", label: "Link do regulamento oficial (https://, opcional)", type: "url" },
  { k: "regulation", label: "Regulamento (texto)", area: 14 },
  { k: "additionalInfo", label: "Informações adicionais", area: 4 },
  { k: "privacyContact", label: "Contato para assuntos de privacidade (LGPD)" },
];

export function LegalForm({ campaignId, initial, readOnly }: { campaignId: string; initial: LegalData; readOnly: boolean }) {
  const { run, busy, error } = useAdminAction();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const ok = await run(`/api/admin/campaigns/${campaignId}/legal`, f, "PUT");
        if (ok !== null) setSaved(true);
      }}
    >
      <p className="rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
        Preencha conforme o enquadramento jurídico/autorização da operação. O sistema não presume que a campanha seja
        permitida; ativar a campanha exige estes dados e uma declaração de conformidade registrada na auditoria.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.k} className={field.area ? "sm:col-span-2" : ""}>
            <label className="label" htmlFor={`lg-${field.k}`}>{field.label}</label>
            {field.area ? (
              <textarea id={`lg-${field.k}`} className="input py-2" rows={field.area} disabled={readOnly} value={f[field.k] as string} onChange={(e) => setF({ ...f, [field.k]: e.target.value })} />
            ) : (
              <input id={`lg-${field.k}`} className="input" type={field.type ?? "text"} disabled={readOnly} value={f[field.k] as string} onChange={(e) => setF({ ...f, [field.k]: e.target.value })} />
            )}
            {field.hint && <p className="mt-1 text-xs text-stone-500">{field.hint}</p>}
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="size-5 accent-brand-600" disabled={readOnly} checked={f.showOnPublicPage} onChange={(e) => setF({ ...f, showOnPublicPage: e.target.checked })} />
        Exibir informações legais na página pública
      </label>
      <ErrorBox error={error} />
      {saved && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 font-medium text-green-900">Informações legais salvas.</p>}
      {!readOnly && (
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Salvando…" : "Salvar informações legais"}
        </button>
      )}
    </form>
  );
}
