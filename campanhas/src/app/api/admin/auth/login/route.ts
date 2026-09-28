import { NextResponse } from "next/server";
import { handler, parseJson } from "@/server/http";
import { login } from "@/server/auth/login";
import { sessionCookie } from "@/server/auth/session";
import { assertSameOrigin } from "@/server/security/request";
import { loginSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  assertSameOrigin(req);
  const body = await parseJson(req, loginSchema);
  const result = await login(req, body.email, body.password);
  const res = NextResponse.json({ ok: true, data: { user: result.user } });
  res.headers.append("set-cookie", sessionCookie(result.token, result.expiresAt));
  return res;
});
