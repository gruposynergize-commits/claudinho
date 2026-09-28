import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { executeDraw, executeSchema } from "@/server/draw/service";

export const dynamic = "force-dynamic";

/** Execução única da apuração (resultado imutável). */
export const POST = handler<RouteContext<{ drawId: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "draw.manage");
  const { drawId } = await ctx.params;
  const body = await parseJson(req, executeSchema);
  return ok(await executeDraw(drawId, body, actor));
});
