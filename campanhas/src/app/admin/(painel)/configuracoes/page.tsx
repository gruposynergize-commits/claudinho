import Link from "next/link";
import { adminPage, type SearchParams } from "@/server/admin/page-context";
import { NoCampaign, NoPermission, PageTitle } from "@/components/admin/states";

const ITEMS = [
  { href: "/admin/configuracoes/campanha", title: "Campanha", text: "Nome, história, imagem, preço, quantidade, datas, limites, FAQ e situação." },
  { href: "/admin/configuracoes/premios", title: "Prêmios", text: "Nome, descrição, imagem, ordem, valor estimado, origem e documentação." },
  { href: "/admin/configuracoes/informacoes-legais", title: "Informações legais", text: "Responsável, entidade, CNPJ, autorização, regulamento, modalidade e apuração." },
  { href: "/admin/configuracoes/pagamentos", title: "Pagamentos → Pix", text: "Modo automático/manual, chave Pix, gateway, credenciais e QR Code estático." },
  { href: "/admin/configuracoes/usuarios", title: "Usuários", text: "Acessos ao painel e papéis (administrador, operador, somente leitura)." },
];

export default async function SettingsIndex({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await adminPage("settings.view", await searchParams);
  if (!ctx.allowed) return <NoPermission />;
  if (!ctx.campaign) return <NoCampaign />;
  return (
    <div>
      <PageTitle title="Configurações" subtitle={ctx.campaign.name} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {ITEMS.filter((i) => i.href !== "/admin/configuracoes/usuarios" || ctx.can("users.manage")).map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="card block h-full hover:border-brand-300">
              <p className="font-bold text-brand-700">{i.title}</p>
              <p className="mt-1 text-sm text-stone-600">{i.text}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
