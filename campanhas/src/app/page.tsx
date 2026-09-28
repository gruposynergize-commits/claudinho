import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { StatusBadge } from "@/components/public/status-badge";

export default async function Home() {
  const campaigns = await db().campaign.findMany({
    where: { deletedAt: null, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: { slug: true, name: true, shortDescription: true, status: true },
  });
  if (campaigns.length === 1) redirect(`/campanha/${campaigns[0]!.slug}`);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold">Campanhas</h1>
      {campaigns.length === 0 ? (
        <p className="mt-4 text-stone-600">Nenhuma campanha publicada no momento.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {campaigns.map((c) => (
            <li key={c.slug}>
              <Link href={`/campanha/${c.slug}`} className="card block hover:border-brand-300">
                <StatusBadge status={c.status} />
                <p className="mt-2 text-lg font-bold">{c.name}</p>
                {c.shortDescription && <p className="text-stone-600">{c.shortDescription}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
