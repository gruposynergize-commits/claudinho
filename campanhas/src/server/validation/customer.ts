import { z } from "zod";
import { isValidCpf, normalizeBrazilPhone, digitsOnly } from "@/lib/format";

/** Remove caracteres de controle e espaços duplicados. */
export function cleanText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const nameSchema = z
  .string({ error: "Informe seu nome completo." })
  .transform(cleanText)
  .pipe(
    z
      .string()
      .min(5, "Informe seu nome completo.")
      .max(100, "Nome muito longo.")
      .regex(/^[\p{L}][\p{L}' .-]*$/u, "Use apenas letras no nome.")
      .refine((v) => v.split(" ").filter((p) => p.length >= 1).length >= 2, "Informe nome e sobrenome."),
  );

export const phoneSchema = z
  .string({ error: "Informe seu WhatsApp." })
  .max(30)
  .transform((v, ctx) => {
    const n = normalizeBrazilPhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "WhatsApp inválido. Use DDD + número." });
      return z.NEVER;
    }
    return n;
  });

export const emailSchema = z
  .string()
  .max(254)
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email({ error: "E-mail inválido." }));

export const cpfSchema = z
  .string()
  .max(20)
  .transform(digitsOnly)
  .refine(isValidCpf, "CPF inválido.");

/** Campos opcionais: string vazia vira undefined. */
export function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());
}

export const customerInputSchema = z.strictObject({
  name: nameSchema,
  phone: phoneSchema,
  email: optional(emailSchema),
  cpf: optional(cpfSchema),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
