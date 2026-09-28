import { handler, ok, parseJson } from "@/server/http";
import { AppError } from "@/server/errors";
import { db } from "@/server/db";
import { getReservationByToken } from "@/server/numbers/reservations";
import { emailRequired } from "@/server/orders/create";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { reservationTokenBodySchema } from "@/server/validation/public";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Dados da reserva para a tela de checkout. */
export const POST = handler(async (req) => {
  await enforceRateLimit("publicRead", clientIpHash(req));
  const { token } = await parseJson(req, reservationTokenBodySchema);
  const r = await getReservationByToken(token);
  if (!r) throw new AppError("NOT_FOUND", "Reserva não encontrada. Escolha os números novamente.");
  const campaign = await db().campaign.findUniqueOrThrow({
    where: { id: r.campaignId },
    select: { requireCpf: true, requireEmail: true, paymentSettings: { select: { mode: true } } },
  });
  return ok({
    campaignSlug: r.campaignSlug,
    numbers: r.numbers.map((n) => formatNumber(n, r.numberDigits)),
    quantity: r.quantity,
    unitPriceCents: r.unitPriceCents,
    totalCents: r.totalCents,
    expiresAt: r.expiresAt.toISOString(),
    usable: r.usable,
    status: r.status,
    requireCpf: campaign.requireCpf,
    requireEmail: emailRequired(campaign.requireEmail, campaign.paymentSettings?.mode ?? "MANUAL"),
  });
});
