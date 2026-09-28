import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-6 text-stone-800">
      <h1 className="text-2xl font-extrabold">Política de privacidade</h1>
      <p>
        Esta política explica como os dados pessoais de participantes são tratados nesta plataforma, conforme a Lei
        Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD). O controlador dos dados de cada campanha é o seu
        organizador, identificado em “Informações legais” na página da campanha, onde também está o canal de contato.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">1. Quais dados coletamos</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Nome completo e número de WhatsApp — para identificar sua participação e permitir a consulta do pedido.</li>
          <li>E-mail — opcional; pode ser exigido quando o processador de pagamentos precisar dele para gerar o Pix.</li>
          <li>CPF — somente se a campanha exigir; é armazenado criptografado.</li>
          <li>Dados do pedido: números escolhidos, valores, datas e situação do pagamento.</li>
          <li>Registros técnicos de segurança (por exemplo, um identificador irreversível derivado do endereço IP), usados para prevenir abusos.</li>
        </ul>
        <p>Não coletamos endereço, dados bancários nem dados de cartão.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">2. Para que usamos</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Registrar e confirmar sua participação e o pagamento (execução do contrato — art. 7º, V).</li>
          <li>Cumprir obrigações legais, regulatórias e de prestação de contas da campanha (art. 7º, II).</li>
          <li>Garantir a segurança da plataforma e prevenir fraudes (legítimo interesse — art. 7º, IX).</li>
          <li>Entrar em contato com vencedores para a entrega de prêmios.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">3. Com quem compartilhamos</h2>
        <p>
          Com o processador de pagamentos (para gerar e confirmar o Pix — nome, e-mail e, se informado, CPF), com
          provedores de hospedagem e infraestrutura necessários ao funcionamento do serviço e com autoridades, quando
          houver obrigação legal. Não vendemos dados.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">4. O que é público</h2>
        <p>
          Nunca publicamos CPF, telefone, e-mail, endereço ou dados de outros compradores. A página da campanha mostra
          apenas totais de números e, após o sorteio, o número vencedor de cada prêmio.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">5. Por quanto tempo guardamos</h2>
        <p>
          Dados de quem não concluiu uma compra são anonimizados automaticamente após 90 dias. Dados de compras
          concluídas são mantidos pelo tempo necessário à realização da campanha, à entrega dos prêmios e ao
          cumprimento de obrigações legais e de prestação de contas; depois, são anonimizados.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">6. Seus direitos</h2>
        <p>
          Você pode solicitar confirmação e acesso aos seus dados, correção, anonimização ou eliminação de dados
          desnecessários, portabilidade, informações sobre compartilhamento e revogação de consentimento (art. 18 da
          LGPD), pelo canal de contato indicado na página da campanha. Alguns dados podem precisar ser mantidos para
          cumprimento de obrigação legal ou regulatória.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">7. Segurança</h2>
        <p>
          Conexão criptografada (HTTPS), CPF criptografado, acesso administrativo restrito por perfis de permissão e
          registro de auditoria das ações administrativas.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">8. Cookies e armazenamento no aparelho</h2>
        <p>
          Usamos apenas o essencial: um cookie de sessão para quem acessa o painel administrativo. No seu aparelho,
          o navegador guarda temporariamente a seleção de números e a lista de pedidos feitos nele, para facilitar a
          consulta. Não usamos cookies de publicidade ou rastreamento.
        </p>
      </section>
    </article>
  );
}
