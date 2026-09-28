import "server-only";
import { currentAdmin } from "./guard";

/** Administradores logados podem pré-visualizar campanhas em rascunho. */
export async function getAdminPreviewAllowed(): Promise<boolean> {
  try {
    return (await currentAdmin()) !== null;
  } catch {
    return false;
  }
}
