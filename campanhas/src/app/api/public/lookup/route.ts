import { handler, ok, parseJson } from "@/server/http";
import { lookupOrderToken } from "@/server/orders/view";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { lookupBodySchema } from "@/server/validation/public";

export const dynamic = "force-dynamic";

/** Consulta de participação: código do pedido + WhatsApp da compra. */
export const POST = handler(async (req) => {
  await enforceRateLimit("lookup", clientIpHash(req));
  const body = await parseJson(req, lookupBodySchema);
  await enforceRateLimit("lookupCode", body.code.trim().toUpperCase());
  const token = await lookupOrderToken(body);
  return ok({ token });
});
