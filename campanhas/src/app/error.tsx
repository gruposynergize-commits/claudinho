"use client";

/** Erro inesperado: mensagem amigável, sem detalhes técnicos. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Algo não saiu como esperado</h1>
      <p className="mt-2 text-stone-600">Não conseguimos carregar esta página. Tente novamente em instantes.</p>
      <button type="button" className="btn-primary mt-6" onClick={() => reset()}>
        Tentar novamente
      </button>
    </div>
  );
}
