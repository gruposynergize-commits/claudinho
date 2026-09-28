"use client";

import { useId, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { Dialog, ErrorBox, useAdminAction } from "./ui";

type U = { id: string; email: string; name: string; role: string; active: boolean; lastLoginAt: string | null; lockedUntil: string | null };

function NewUser() {
  const { run, busy, error } = useAdminAction();
  const id = useId();
  const [f, setF] = useState({ email: "", name: "", role: "OPERATOR", password: "" });
  return (
    <Dialog trigger="Novo usuário" title="Novo usuário do painel" triggerClassName="btn-primary">
      {(close) => (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run("/api/admin/users", f);
            if (ok !== null) close();
          }}
        >
          <div><label className="label" htmlFor={`${id}-e`}>E-mail</label><input id={`${id}-e`} className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>
          <div><label className="label" htmlFor={`${id}-n`}>Nome</label><input id={`${id}-n`} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div>
            <label className="label" htmlFor={`${id}-r`}>Papel</label>
            <select id={`${id}-r`} className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="ADMIN">Administrador — acesso completo</option>
              <option value="OPERATOR">Operador — vendas e atendimento</option>
              <option value="VIEWER">Somente leitura</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`${id}-p`}>Senha inicial</label>
            <input id={`${id}-p`} className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
            <p className="mt-1 text-xs text-stone-500">Mínimo 12 caracteres, com 3 tipos (minúsculas, maiúsculas, números, símbolos).</p>
          </div>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={busy}>Criar</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function UserRow({ u, self }: { u: U; self: boolean }) {
  const { run, busy, error } = useAdminAction();
  const [pwd, setPwd] = useState("");
  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold">{u.name} {self && <span className="text-sm font-normal text-stone-500">(você)</span>}</p>
          <p className="text-sm text-stone-600">{u.email} · {ROLE_LABEL[u.role]} · {u.active ? "ativo" : "desativado"}</p>
          <p className="text-xs text-stone-500">Último acesso: {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "nunca"}{u.lockedUntil && new Date(u.lockedUntil) > new Date() ? " · bloqueado temporariamente" : ""}</p>
        </div>
        {!self && (
          <div className="flex flex-wrap gap-2">
            <select aria-label="Papel" className="input min-h-10 w-auto py-1 text-sm" value={u.role} disabled={busy} onChange={(e) => void run(`/api/admin/users/${u.id}`, { role: e.target.value })}>
              <option value="ADMIN">Administrador</option>
              <option value="OPERATOR">Operador</option>
              <option value="VIEWER">Somente leitura</option>
            </select>
            <button type="button" className="btn-ghost min-h-10 text-sm" disabled={busy} onClick={() => void run(`/api/admin/users/${u.id}`, { active: !u.active })}>
              {u.active ? "Desativar" : "Reativar"}
            </button>
            <Dialog trigger="Redefinir senha" title={`Redefinir senha de ${u.email}`} triggerClassName="btn-ghost min-h-10 text-sm">
              {(close) => (
                <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run(`/api/admin/users/${u.id}/password`, { password: pwd }); if (ok !== null) { setPwd(""); close(); } }}>
                  <input className="input" type="password" autoComplete="new-password" aria-label="Nova senha" value={pwd} onChange={(e) => setPwd(e.target.value)} />
                  <p className="text-xs text-stone-500">As sessões abertas do usuário serão encerradas.</p>
                  <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={close}>Cancelar</button><button type="submit" className="btn-primary" disabled={busy}>Salvar</button></div>
                </form>
              )}
            </Dialog>
          </div>
        )}
      </div>
      <ErrorBox error={error} />
    </li>
  );
}

export function UsersManager({ users, selfId }: { users: U[]; selfId: string }) {
  return (
    <div className="space-y-3">
      <NewUser />
      <ul className="space-y-3">{users.map((u) => <UserRow key={u.id} u={u} self={u.id === selfId} />)}</ul>
    </div>
  );
}
