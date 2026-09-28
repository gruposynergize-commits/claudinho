import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { generateStaticQr } from "@/server/admin/payment-settings";
import { staticQrSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

/** QR Code estático avulso — "Pix estático — confirmação manual". */
export const POST = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  await requireAdmin(req, "orders.manage");
  const { id } = await ctx.params;
  const campaign = await requireCampaignById(id);
  const body = await parseJson(req, staticQrSchema);
  return ok(await generateStaticQr(campaign.id, body.amountCents, body.description));
});
