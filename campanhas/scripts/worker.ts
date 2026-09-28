/**
 * Worker de rotinas para ambientes com processo contínuo (VPS/Docker):
 *   npm run worker
 *
 * - expire   (30 s): reservas vencidas, Pix manual vencido, pedidos
 *                    automáticos vencidos (consultando/cancelando no gateway)
 * - reconcile(60 s): conciliação de pagamentos pendentes/aprovados
 * - cleanup  (1 h):  rate limits, sessões, logs antigos, retenção LGPD
 *
 * Cada rotina usa "lease" no banco: pode haver mais de um worker (ou cron)
 * sem execução simultânea da mesma rotina.
 */
import "dotenv/config";
import { runJob, type JobName } from "../src/server/jobs";
import { disconnectDb } from "../src/server/db";

const SCHEDULE: Record<JobName, number> = {
  expire: 30_000,
  reconcile: 60_000,
  cleanup: 3_600_000,
};

let stopping = false;
const timers: NodeJS.Timeout[] = [];

async function tick(job: JobName) {
  if (stopping) return;
  const started = Date.now();
  try {
    const out = await runJob(job);
    if (out.ran) console.log(JSON.stringify({ ts: new Date().toISOString(), job, ms: Date.now() - started, result: out.result }));
  } catch (e) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), job, error: (e as Error).message }));
  } finally {
    if (!stopping) timers.push(setTimeout(() => void tick(job), SCHEDULE[job]));
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`worker: ${signal} recebido, encerrando…`);
  for (const t of timers) clearTimeout(t);
  await disconnectDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log("worker: iniciado");
for (const job of Object.keys(SCHEDULE) as JobName[]) void tick(job);
