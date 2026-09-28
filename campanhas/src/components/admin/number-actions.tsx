"use client";

import { ReasonAction } from "./ui";

export function NumberActions({
  campaignId,
  number,
  label,
  status,
  canManage,
  canExceptional,
}: {
  campaignId: string;
  number: number;
  label: string;
  status: string;
  canManage: boolean;
  canExceptional: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {status === "RESERVED" && canManage && (
        <ReasonAction
          label="Liberar reserva"
          title={`Liberar reserva do número ${label}`}
          description="Libera toda a reserva de carrinho a que este número pertence."
          url="/api/admin/numbers/release"
          extraBody={{ campaignId, number }}
          confirmLabel="Liberar"
          minLength={3}
        />
      )}
      {status === "AVAILABLE" && canExceptional && (
        <ReasonAction
          label="Bloquear"
          title={`Bloquear número ${label}`}
          description="Operação excepcional: o número deixa de ser vendido até ser desbloqueado. Fica registrada na auditoria."
          url="/api/admin/numbers/block"
          extraBody={{ campaignId, number }}
          confirmLabel="Bloquear"
          danger
        />
      )}
      {status === "CANCELLED" && canExceptional && (
        <ReasonAction
          label="Desbloquear"
          title={`Desbloquear número ${label}`}
          description="Operação excepcional: o número volta a ficar disponível para venda. Não se aplica a números pagos."
          url="/api/admin/numbers/unblock"
          extraBody={{ campaignId, number }}
          confirmLabel="Desbloquear"
        />
      )}
    </div>
  );
}
