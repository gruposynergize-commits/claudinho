import { z } from "zod";
import { customerInputSchema } from "./customer";

/** Schemas estritos: qualquer campo extra (ex.: preço, status) é rejeitado. */

const token = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);

export const reserveBodySchema = z.strictObject({
  numbers: z.array(z.number().int()).min(1).max(10_000),
  replaceToken: token.optional().nullable(),
});

export const reservationTokenBodySchema = z.strictObject({
  token,
});

export const createOrderBodySchema = z.strictObject({
  reservationToken: token,
  customer: customerInputSchema,
  acceptTerms: z.literal(true, { error: "É preciso aceitar o regulamento." }),
  acceptPrivacy: z.literal(true, { error: "É preciso aceitar a política de privacidade." }),
  idempotencyKey: z.uuid(),
});

export const reportPaidBodySchema = z.strictObject({
  note: z.string().max(300).optional(),
});

export const lookupBodySchema = z.strictObject({
  code: z.string().min(5).max(40),
  phone: z.string().min(8).max(30),
});
