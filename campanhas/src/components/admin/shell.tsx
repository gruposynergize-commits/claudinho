import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/server/auth/guard";
import { can, type Permission } from "@/server/auth/rbac";
import { listAdminCampaigns } from "@/server/admin/context";
import { ROLE_LABEL } from "@/lib/labels";
import { AdminNav, CampaignSwitcher, LogoutButton, type NavItem } from "./nav";

const NAV: (NavItem & { perm: Permission })[] = [
  { href: "/admin", label: "Dashboard", perm: "dashboard.view" },
  { href: "/admin/pedidos", label: "Pedidos", perm: "orders.view" },
  { href: "/admin/numeros", label: "Números", perm: "orders.view" },
  { href: "/admin/compradores", label: "Compradores", perm: "orders.view" },
  { href: "/admin/pagamentos", label: "Pagamentos", perm: "orders.view" },
  { href: "/admin/sorteio", label: "Sorteio", perm: "draw.view" },
  { href: "/admin/configuracoes", label: "Configurações", perm: "settings.view" },
  { href: "/admin/auditoria", label: "Auditoria", perm: "audit.view" },
  { href: "/admin/sistema/logs", label: "Sistema → Logs", perm: "system.view" },
  { href: "/status", label: "Status", perm: "system.view" },
];

/** Moldura do painel (usuário, campanha em foco, navegação filtrada por papel). */
export async function AdminShell({ children, loginNext }: { children: React.ReactNode; loginNext?: string }) {
  const user = await currentAdmin();
  if (!user) redirect(loginNext ? `/admin/login?next=${encodeURIComponent(loginNext)}` : "/admin/login");
  const campaigns = await listAdminCampaigns();
  const jar = await cookies();
  const current = jar.get("admin_campaign")?.value ?? campaigns[0]?.slug ?? null;
  const items = NAV.filter((i) => can(user.role, i.perm)).map(({ href, label }) => ({ href, label }));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">
          <strong className="text-stone-900">{user.name}</strong> · {ROLE_LABEL[user.role]}
        </p>
        <div className="flex items-center gap-2">
          <CampaignSwitcher campaigns={campaigns} current={current} />
          <a href="/admin/conta" className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
            Minha conta
          </a>
          <LogoutButton />
        </div>
      </div>
      <AdminNav items={items} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
