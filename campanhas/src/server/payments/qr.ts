import "server-only";
import QRCode from "qrcode";
import { parseBrCode } from "@/lib/pix/brcode";
import { logEvent } from "../logger";

/** SVG do QR Code gerado no servidor a partir do "copia e cola". */
export async function qrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 280 });
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Confere um "copia e cola" antes de exibir ao comprador: CRC válido e, se
 * houver valor no código, igual ao total do pedido. Protege contra resposta
 * corrompida do gateway ou configuração errada.
 */
export async function validatePixPayloadForOrder(
  payload: string,
  expectedCents: number,
  context: Record<string, unknown>,
): Promise<boolean> {
  try {
    const parsed = parseBrCode(payload);
    if (!parsed.crcValid) {
      await logEvent("CRITICAL", "PAYMENT", "BR Code com CRC inválido não foi exibido", context);
      return false;
    }
    if (parsed.amountCents !== null && parsed.amountCents !== expectedCents) {
      await logEvent("CRITICAL", "PAYMENT", "BR Code com valor diferente do pedido não foi exibido", {
        ...context,
        payloadCents: parsed.amountCents,
        expectedCents,
      });
      return false;
    }
    return true;
  } catch (e) {
    await logEvent("CRITICAL", "PAYMENT", "BR Code ilegível não foi exibido", { ...context, error: (e as Error).message });
    return false;
  }
}
