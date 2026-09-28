import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/shell";

export const metadata: Metadata = { title: { default: "Painel", template: "%s · Painel" }, robots: { index: false, follow: false } };

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
