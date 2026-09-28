import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentAdmin } from "@/server/auth/guard";
import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = { title: "Entrar no painel", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-extrabold">Painel administrativo</h1>
      <p className="text-stone-600">Acesso restrito à organização.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
