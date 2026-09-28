import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (antigo middleware): gera um nonce por requisição e aplica uma
 * Content Security Policy estrita (sem scripts inline não autorizados).
 * Também faz um redirecionamento rápido do painel sem cookie de sessão — a
 * verificação real de autenticação/permissão acontece no servidor.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Em desenvolvimento, as ferramentas do Next injetam <style> sem nonce.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    isDev ? "style-src-elem 'self' 'unsafe-inline'" : `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const { pathname } = request.nextUrl;
  const restricted = (pathname.startsWith("/admin") && pathname !== "/admin/login") || pathname === "/status";
  // Redirecionamento rápido só com a presença do cookie (qualquer um dos dois
  // nomes); a validação real da sessão e da permissão acontece no servidor.
  if (restricted && !request.cookies.has("__Host-campanhas_session") && !request.cookies.has("campanhas_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
