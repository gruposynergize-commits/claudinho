import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { handler, type RouteContext } from "@/server/http";
import { safeEqual } from "@/server/crypto";
import { JOBS, runJob, type JobName } from "@/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Endpoints para agendadores externos (ex.: Vercel Cron): Authorization: Bearer <CRON_SECRET>. */
async function run(req: NextRequest, ctx: RouteContext<{ job: string }>) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw new AppError("UNAUTHENTICATED", "Não autorizado.");
  const { job } = await ctx.params;
  if (!JOBS.includes(job as JobName)) throw new AppError("NOT_FOUND", "Rotina desconhecida.");
  const out = await runJob(job as JobName);
  return NextResponse.json({ ok: true, ...out });
}

export const GET = handler<RouteContext<{ job: string }>>(run);
export const POST = handler<RouteContext<{ job: string }>>(run);
