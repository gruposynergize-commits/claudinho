import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <p className="mt-2 text-stone-600">O endereço pode estar incorreto ou o conteúdo não está mais disponível.</p>
      <Link href="/" className="btn-primary mt-6">Ir para o início</Link>
    </div>
  );
}
