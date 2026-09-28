"use client";

import { useSyncExternalStore } from "react";
import { safeStorage } from "./api-client";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

const serverSnapshot = () => undefined;

/**
 * Valor do sessionStorage/localStorage compatível com SSR: `undefined` no
 * servidor e durante a hidratação; depois, o valor salvo (ou null).
 */
export function useStoredValue(kind: "session" | "local", key: string): string | null | undefined {
  return useSyncExternalStore(subscribe, () => safeStorage.get(kind, key), serverSnapshot);
}
