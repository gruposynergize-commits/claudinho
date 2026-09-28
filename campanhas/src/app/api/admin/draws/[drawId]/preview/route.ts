import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { executeSchema, previewDraw } from "@/server/draw/service";

export const dynamic = "force-dynamic";

/** Calcula sem gravar (métodos determinísticos): confere a digitação antes de registrar. */
export const POST = handler<RouteContext<{ drawId: string }>>(async (req, ctx) => {
  await requireAdmin(req, "draw.manage");
  const { drawId } = await ctx.params;
  const body = await parseJson(req, executeSchema);
  return ok(await previewDraw(drawId, body));
});
