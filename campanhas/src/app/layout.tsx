import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Campanhas", template: "%s · Campanhas" },
  description: "Participe das campanhas com transparência: números, pagamento Pix e sorteio auditável.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b4225a",
};

// Todas as páginas são dinâmicas: dados sempre atuais e nonce de CSP por requisição.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Lê o nonce gerado no proxy.ts (o Next aplica-o aos scripts automaticamente).
  await headers();
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">
          Pular para o conteúdo
        </a>
        <header className="border-b border-stone-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Link href="/" className="text-lg font-extrabold tracking-tight text-brand-700">
              Campanhas
            </Link>
            <nav aria-label="Principal">
              <Link href="/consultar" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">
                Consultar participação
              </Link>
            </nav>
          </div>
        </header>
        <main id="conteudo" className="flex-1">
          {children}
        </main>
        <footer className="mt-12 border-t border-stone-200 bg-white">
          <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 text-sm text-stone-600">
            <nav aria-label="Rodapé" className="flex flex-wrap gap-x-5 gap-y-2 font-medium">
              <Link href="/consultar" className="hover:text-brand-700">Consultar participação</Link>
              <Link href="/privacidade" className="hover:text-brand-700">Política de privacidade</Link>
              <Link href="/termos" className="hover:text-brand-700">Termos de uso</Link>
            </nav>
            <p>
              Esta plataforma é uma ferramenta de gestão. Cada campanha é de responsabilidade do seu organizador, que
              deve operá-la conforme o regulamento e a autorização aplicáveis, informados na página da campanha.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
