import { handler, ok, parseJson } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { blockNumber } from "@/server/admin/numbers";
import { numberActionSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  const { actor } = await requireAdmin(req, "numbers.exceptional");
  const body = await parseJson(req, numberActionSchema);
  await blockNumber(body.campaignId, body.number, body.reason, actor);
  return ok({ done: true });
});
