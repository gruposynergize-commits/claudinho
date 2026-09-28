import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Status do sistema", robots: { index: false, follow: false } };

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell loginNext="/status">{children}</AdminShell>;
}
