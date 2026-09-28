import type { Metadata } from "next";
import { adminPage } from "@/server/admin/page-context";
import { db } from "@/server/db";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { PageTitle } from "@/components/admin/states";
import { ChangePasswordForm } from "@/components/admin/change-password-form";

export const metadata: Metadata = { title: "Minha conta" };

export default async function AccountPage() {
  const { user } = await adminPage("dashboard.view");
  const [profile, sessions] = await Promise.all([
    db().user.findUnique({ where: { id: user.id }, select: { lastLoginAt: true, passwordChangedAt: true, createdAt: true } }),
    db().session.count({ where: { userId: user.id, expiresAt: { gt: new Date() } } }),
  ]);
  return (
    <div className="space-y-5">
      <PageTitle title="Minha conta" />
      <dl className="card grid max-w-lg gap-3 sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase text-stone-500">Nome</dt><dd>{user.name}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-stone-500">E-mail</dt><dd className="break-all">{user.email}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-stone-500">Papel</dt><dd>{ROLE_LABEL[user.role]}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-stone-500">Sessões abertas</dt><dd>{sessions}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-stone-500">Último login</dt><dd>{profile?.lastLoginAt ? formatDateTime(profile.lastLoginAt) : "—"}</dd></div>
        <div><dt className="text-xs font-semibold uppercase text-stone-500">Senha alterada em</dt><dd>{profile?.passwordChangedAt ? formatDateTime(profile.passwordChangedAt) : "—"}</dd></div>
      </dl>
      <ChangePasswordForm />
    </div>
  );
}
