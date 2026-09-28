"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export type NavItem = { href: string; label: string };

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Painel" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
      {items.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${active ? "bg-brand-600 text-white" : "text-stone-700 hover:bg-stone-100"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function CampaignSwitcher({ campaigns, current }: { campaigns: { slug: string; name: string }[]; current: string | null }) {
  const router = useRouter();
  if (campaigns.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold">Campanha:</span>
      <select
        className="input min-h-10 w-auto py-1"
        value={current ?? ""}
        onChange={(e) => {
          document.cookie = `admin_campaign=${encodeURIComponent(e.target.value)}; path=/; samesite=lax`;
          router.refresh();
        }}
      >
        {campaigns.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-lg px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100"
      onClick={async () => {
        await api("/api/admin/auth/logout", { method: "POST", body: {} });
        router.replace("/admin/login");
        router.refresh();
      }}
    >
      Sair
    </button>
  );
}
