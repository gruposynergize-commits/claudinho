import type { UserRole } from "@/generated/prisma/client";

/**
 * Permissões do painel.
 * - VIEWER: somente leitura (dados pessoais mascarados).
 * - OPERATOR: vendas e atendimento.
 * - ADMIN: tudo, inclusive configurações, sorteio, exceções e usuários.
 */
export type Permission =
  | "dashboard.view"
  | "orders.view"
  | "orders.manage"
  | "payments.confirmManual"
  | "payments.check"
  | "payments.resolve"
  | "orders.refund"
  | "orders.editPaid"
  | "numbers.manage"
  | "numbers.exceptional"
  | "customers.viewPII"
  | "customers.manage"
  | "lgpd.anonymize"
  | "settings.view"
  | "settings.manage"
  | "users.manage"
  | "draw.view"
  | "draw.manage"
  | "audit.view"
  | "system.view"
  | "export.data";

const ALL: UserRole[] = ["ADMIN", "OPERATOR", "VIEWER"];
const OPS: UserRole[] = ["ADMIN", "OPERATOR"];
const ADMIN: UserRole[] = ["ADMIN"];

export const PERMISSIONS: Record<Permission, UserRole[]> = {
  "dashboard.view": ALL,
  "orders.view": ALL,
  "orders.manage": OPS,
  "payments.confirmManual": OPS,
  "payments.check": OPS,
  "payments.resolve": ADMIN,
  "orders.refund": ADMIN,
  "orders.editPaid": ADMIN,
  "numbers.manage": OPS,
  "numbers.exceptional": ADMIN,
  "customers.viewPII": OPS,
  "customers.manage": OPS,
  "lgpd.anonymize": ADMIN,
  "settings.view": ALL,
  "settings.manage": ADMIN,
  "users.manage": ADMIN,
  "draw.view": ALL,
  "draw.manage": ADMIN,
  "audit.view": ADMIN,
  "system.view": ADMIN,
  "export.data": ADMIN,
};

export function can(role: UserRole, permission: Permission): boolean {
  return PERMISSIONS[permission].includes(role);
}
