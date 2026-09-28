import { handler, ok, parseJson, type RouteContext } from "@/server/http";
import { reserveNumbers } from "@/server/numbers/reservations";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { clientIpHash } from "@/server/security/request";
import { reserveBodySchema } from "@/server/validation/public";

export const dynamic = "force-dynamic";

/** Reserva temporária (tudo ou nada) dos números escolhidos. */
export const POST = handler<RouteContext<{ slug: string }>>(async (req, ctx) => {
  const { slug } = await ctx.params;
  const ipHash = clientIpHash(req);
  await enforceRateLimit("reservation", ipHash);
  const body = await parseJson(req, reserveBodySchema, { maxBytes: 80_000 });
  const r = await reserveNumbers({ campaignSlug: slug, numbers: body.numbers, replaceToken: body.replaceToken, ipHash });
  return ok(
    {
      token: r.token,
      numbers: r.numbers,
      numberDigits: r.numberDigits,
      quantity: r.quantity,
      unitPriceCents: r.unitPriceCents,
      totalCents: r.totalCents,
      expiresAt: r.expiresAt.toISOString(),
    },
    { status: 201 },
  );
});
