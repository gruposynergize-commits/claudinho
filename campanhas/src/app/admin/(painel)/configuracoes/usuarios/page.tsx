import { adminPage } from "@/server/admin/page-context";
import { listUsers } from "@/server/admin/users";
import { NoPermission, PageTitle } from "@/components/admin/states";
import { UsersManager } from "@/components/admin/users-manager";

export default async function UsersPage() {
  const ctx = await adminPage("users.manage");
  if (!ctx.allowed) return <NoPermission />;
  const users = await listUsers();
  return (
    <div>
      <PageTitle title="Configurações → Usuários" subtitle="Administrador: acesso completo · Operador: vendas e atendimento · Somente leitura: consulta com dados pessoais mascarados." />
      <UsersManager
        selfId={ctx.user.id}
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          active: u.active,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          lockedUntil: u.lockedUntil?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
