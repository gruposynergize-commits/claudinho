import { NextResponse } from "next/server";
import { handler } from "@/server/http";
import { clearedSessionCookie, revokeSessionToken, sessionCookieName } from "@/server/auth/session";
import { assertSameOrigin } from "@/server/security/request";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  assertSameOrigin(req);
  await revokeSessionToken(req.cookies.get(sessionCookieName())?.value);
  const res = NextResponse.json({ ok: true, data: null });
  res.headers.append("set-cookie", clearedSessionCookie());
  return res;
});
