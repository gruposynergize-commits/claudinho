import { z } from "zod";
import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { finalizeDraw } from "@/server/draw/service";

export const dynamic = "force-dynamic";

const schema = z.strictObject({ confirmFinalize: z.boolean(), notes: z.string().trim().max(2000).optional() });

/** Homologação: confere a elegibilidade dos vencedores e encerra a campanha como sorteada. */
export const POST = handler<RouteContext<{ drawId: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "draw.manage");
  const { drawId } = await ctx.params;
  const body = await parseJson(req, schema);
  await finalizeDraw(drawId, body, actor);
  return ok({ finalized: true });
});
