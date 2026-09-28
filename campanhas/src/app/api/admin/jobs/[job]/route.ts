import { handler, ok, type RouteContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { requireAdmin } from "@/server/auth/guard";
import { JOBS, runJob, type JobName } from "@/server/jobs";

export const dynamic = "force-dynamic";

/** Executa uma rotina agora (ex.: conciliação antes de congelar o sorteio). */
export const POST = handler<RouteContext<{ job: string }>>(async (req, ctx) => {
  await requireAdmin(req, "system.view");
  const { job } = await ctx.params;
  if (!JOBS.includes(job as JobName)) throw new AppError("NOT_FOUND", "Rotina desconhecida.");
  return ok(await runJob(job as JobName));
});
