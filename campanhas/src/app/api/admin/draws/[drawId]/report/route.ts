import { NextResponse } from "next/server";
import { handler, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { can } from "@/server/auth/rbac";
import { drawReport } from "@/server/draw/service";
import { shortName } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Relatório completo do sorteio (JSON), para arquivo e conferência. */
export const GET = handler<RouteContext<{ drawId: string }>>(async (req, ctx) => {
  const { user } = await requireAdmin(req, "draw.view");
  const { drawId } = await ctx.params;
  const report = await drawReport(drawId);
  if (!can(user.role, "customers.viewPII")) {
    report.results = report.results.map((r) => ({ ...r, buyerName: shortName(r.buyerName) }));
  }
  return new NextResponse(JSON.stringify(report, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="sorteio-${report.campaign.slug}-${drawId.slice(0, 8)}.json"`,
      "cache-control": "no-store",
    },
  });
});
