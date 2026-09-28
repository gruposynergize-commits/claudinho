import { handler, ok, parseJson } from "@/server/http";
import { releaseReservation } from "@/server/numbers/reservations";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { reservationTokenBodySchema } from "@/server/validation/public";

export const dynamic = "force-dynamic";

/** O comprador desistiu/voltou: devolve os números imediatamente. */
export const POST = handler(async (req) => {
  await enforceRateLimit("publicRead", clientIpHash(req));
  const { token } = await parseJson(req, reservationTokenBodySchema);
  const released = await releaseReservation(token);
  return ok({ released });
});
