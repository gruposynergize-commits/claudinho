import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de uso" };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-6 text-stone-800">
      <h1 className="text-2xl font-extrabold">Termos de uso</h1>
      <p>
        Esta plataforma é uma ferramenta de gestão de campanhas de números. Cada campanha é organizada e operada pelo
        responsável identificado em sua página, que responde pela regularidade da operação perante a legislação e as
        autorizações aplicáveis. A participação em cada campanha é regida pelo seu regulamento.
      </p>
      <section className="space-y-2">
        <h2 className="text-lg font-bold">Reserva e pagamento</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Ao avançar para o pagamento, os números escolhidos ficam reservados por tempo limitado, informado na tela.</li>
          <li>O valor é calculado pelo sistema com o preço oficial da campanha.</li>
          <li>
            A participação só é confirmada quando o pagamento é identificado pelo sistema de pagamentos ou, no Pix
            manual, conferido pela organização. Comprovantes ou avisos de pagamento não confirmam a compra por si só.
          </li>
          <li>Se o prazo terminar sem pagamento confirmado, os números voltam a ficar disponíveis.</li>
          <li>Pagamentos com valor diferente do pedido não confirmam a participação e são tratados pela organização.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-bold">Sorteio</h2>
        <p>
          O método oficial de apuração e a data constam do regulamento. Antes do sorteio, a lista de números pagos é
          congelada e sua impressão digital (hash SHA-256) é registrada, permitindo verificar que não foi alterada.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-bold">Uso adequado</h2>
        <p>
          É proibido usar automações para reservar números em massa, tentar burlar limites ou acessar dados de
          outras pessoas. Tentativas suspeitas são registradas e podem ser bloqueadas.
        </p>
      </section>
    </article>
  );
}
