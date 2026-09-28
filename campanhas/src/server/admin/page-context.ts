import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentAdmin } from "../auth/guard";
import { can, type Permission } from "../auth/rbac";
import { resolveAdminCampaign } from "./context";

export type SearchParams = Record<string, string | string[] | undefined>;

export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Contexto de uma página do painel: usuário (ou redireciona para o login),
 * se tem a permissão pedida e a campanha em foco (?c=slug ou cookie).
 */
export async function adminPage(permission: Permission, sp: SearchParams = {}) {
  const user = await currentAdmin();
  if (!user) redirect("/admin/login");
  const jar = await cookies();
  const campaign = await resolveAdminCampaign(param(sp, "c") ?? jar.get("admin_campaign")?.value ?? null);
  return { user, allowed: can(user.role, permission), campaign, can: (p: Permission) => can(user.role, p) };
}
