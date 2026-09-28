import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { annulDraw } from "@/server/draw/service";
import { reasonSchema } from "@/server/validation/admin";

export const dynamic = "force-dynamic";

/** Anulação pública e auditada (antes da homologação; nunca para CSPRNG já executado). */
export const POST = handler<RouteContext<{ drawId: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "draw.manage");
  const { drawId } = await ctx.params;
  const body = await parseJson(req, reasonSchema);
  await annulDraw(drawId, body.reason, actor);
  return ok({ annulled: true });
});
