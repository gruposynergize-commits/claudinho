import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { reportPaidByCustomer } from "@/server/orders/lifecycle";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { reportPaidBodySchema } from "@/server/validation/public";

export const dynamic = "force-dynamic";

/** "Já paguei" no Pix manual: registra o aviso; NÃO confirma o pagamento. */
export const POST = handler<RouteContext<{ token: string }>>(async (req, ctx) => {
  const { token } = await ctx.params;
  await enforceRateLimit("order", clientIpHash(req));
  const body = await parseJson(req, reportPaidBodySchema);
  await reportPaidByCustomer(token, body.note);
  return ok({ status: "PENDING_PAYMENT", message: "Recebemos seu aviso. A confirmação acontece após a conferência do pagamento." });
});
