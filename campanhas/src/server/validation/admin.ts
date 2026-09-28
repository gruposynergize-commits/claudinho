import { z } from "zod";
import { customerInputSchema } from "./customer";

const reason = z.string().trim().min(5, "Informe o motivo.").max(2000);
const uuid = z.uuid();

export const loginSchema = z.strictObject({
  email: z.string().trim().max(254),
  password: z.string().min(1).max(200),
});

export const confirmPaymentSchema = z.strictObject({
  verifiedAmountCents: z.number().int().min(1).max(1_000_000_000),
  reference: z.string().trim().min(3).max(200),
  reason,
  confirmedVerification: z.literal(true, { error: "Confirme que verificou o pagamento na conta." }),
});

export const reasonSchema = z.strictObject({ reason });

export const noteSchema = z.strictObject({ body: z.string().trim().min(2).max(2000) });

export const correctCustomerSchema = z.strictObject({
  name: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(254).nullable().optional(),
  reason,
});

export const adminOrderSchema = z.strictObject({
  campaignId: uuid,
  numbers: z.array(z.number().int()).min(1).max(10_000),
  customer: customerInputSchema,
  customerAcceptedTerms: z.literal(true, { error: "Confirme o aceite do comprador." }),
});

export const numberActionSchema = z.strictObject({
  campaignId: uuid,
  number: z.number().int().min(0),
  reason,
});

export const resolvePaymentSchema = z.strictObject({
  notes: z.string().trim().min(10).max(2000),
  markRefunded: z.boolean(),
});

export const statusActionSchema = z.strictObject({
  action: z.enum(["activate", "pause", "resume", "close", "reopen", "cancel"]),
  reason: z.string().max(1000).optional(),
  complianceDeclaration: z.boolean().optional(),
});

export const staticQrSchema = z.strictObject({
  amountCents: z.number().int().min(1).max(100_000_000).nullable(),
  description: z.string().trim().max(60).nullable(),
});

export const userUpdateSchema = z.strictObject({
  role: z.enum(["ADMIN", "OPERATOR", "VIEWER"]).optional(),
  active: z.boolean().optional(),
  name: z.string().trim().min(2).max(100).optional(),
});

export const passwordSchema = z.strictObject({ password: z.string().min(1).max(200) });

export const changeOwnPasswordSchema = z.strictObject({
  current: z.string().min(1).max(200),
  next: z.string().min(1).max(200),
});

export const customerUpdateSchema = z.strictObject({
  name: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(254).optional(),
  reason,
});
