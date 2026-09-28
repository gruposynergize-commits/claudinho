import { NextResponse } from "next/server";
import { handler, type RouteContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { requireAdmin } from "@/server/auth/guard";
import { requireCampaignById } from "@/server/admin/context";
import { EXPORT_TYPES, exportCsv, type ExportType } from "@/server/admin/export";

export const dynamic = "force-dynamic";

export const GET = handler<RouteContext<{ id: string; type: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "export.data");
  const { id, type } = await ctx.params;
  if (!EXPORT_TYPES.includes(type as ExportType)) throw new AppError("NOT_FOUND", "Exportação desconhecida.");
  const campaign = await requireCampaignById(id);
  const csv = await exportCsv(campaign.id, type as ExportType, actor);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${campaign.slug}-${type}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
});
