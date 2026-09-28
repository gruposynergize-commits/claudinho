import { NextResponse } from "next/server";
import { handler, type RouteContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { publicEligibleList } from "@/server/draw/service";

export const dynamic = "force-dynamic";

/**
 * Lista elegível no formato canônico. `sha256sum` deste arquivo deve ser
 * igual ao hash publicado no congelamento. Só números — nenhum dado pessoal.
 */
export const GET = handler<RouteContext<{ drawId: string }>>(async (req, ctx) => {
  await enforceRateLimit("publicRead", clientIpHash(req));
  const { drawId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(drawId)) throw new AppError("NOT_FOUND", "Lista não encontrada.");
  const list = await publicEligibleList(drawId);
  if (!list) throw new AppError("NOT_FOUND", "Lista não encontrada.");
  return new NextResponse(list.text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${list.slug}-lista-elegivel-${list.hash.slice(0, 12)}.txt"`,
      "cache-control": "public, max-age=300",
      "x-content-sha256": list.hash,
    },
  });
});
