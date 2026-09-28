import { NextResponse } from "next/server";
import { handler, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth/guard";
import { exportCustomerData } from "@/server/admin/customers";

export const dynamic = "force-dynamic";

/** Atendimento ao direito de acesso (LGPD): JSON com os dados do titular. */
export const GET = handler<RouteContext<{ id: string }>>(async (req, ctx) => {
  const { actor } = await requireAdmin(req, "export.data");
  const { id } = await ctx.params;
  const data = await exportCustomerData(id, actor);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="titular-${id}.json"`,
      "cache-control": "no-store",
    },
  });
});
