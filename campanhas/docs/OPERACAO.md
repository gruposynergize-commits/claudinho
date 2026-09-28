# Operação — manual do dia a dia

Público: administradores (ADMIN) e operadores (OPERATOR) da campanha.

## 1. Acessos

| Papel | Pode | Não pode |
|---|---|---|
| **ADMIN** | tudo: configurações, usuários, exceções, reembolsos, sorteio, auditoria, logs, `/status`, exportações | — |
| **OPERATOR** | pedidos, confirmação de Pix manual, verificar no gateway, liberar reserva, atendimento a compradores | configurações, sorteio, bloqueio de números, auditoria, exportações, reembolso |
| **VIEWER** | consultar painel (telefone/e-mail mascarados) | qualquer alteração |

- Primeiro administrador: `npm run create-admin -- --email=… --name="…"`
  (a senha é gerada e exibida uma vez). Troque-a em **Minha conta**.
- Novos usuários: **Configurações → Usuários** (senha forte obrigatória).
  Desativar um usuário encerra as sessões dele na hora.
- Sessão expira em 12 h (ou 2 h sem uso). 5 senhas erradas bloqueiam a conta
  por 15 min.

## 2. Antes de abrir as vendas

1. **Configurações → Informações legais**: responsável, entidade, CNPJ,
   número de autorização/certificado (quando aplicável), regulamento, datas,
   modalidade, método oficial de apuração. Marque "exibir na página pública".
2. **Configurações → Prêmios**: nome, descrição, imagem, ordem, valor
   estimado, **origem** (doação, compra, patrocínio…) e documentação. Não
   marque "doação" sem registro.
3. **Configurações → Campanha**: história, foto, preço, quantidade, limites
   por pedido/comprador, tempos de reserva e pagamento, datas, método de
   sorteio, FAQ, contato, mensagem de confirmação.
4. **Configurações → Pagamentos**: modo **Automático** (recomendado) com
   gateway configurado e webhook ativo — ou **Manual** (Pix estático, cada
   pagamento conferido à mão). Confira o nome do recebedor e a cidade.
5. `/status`: tudo verde (banco, gateway, webhook, rotinas).
6. Faça uma compra real de baixo valor e confira a confirmação automática.
7. **Configurações → Campanha → Ativar campanha**: o sistema lista o que
   falta e exige a declaração de conformidade.

## 3. Rotina diária

1. Abra `/status` (ADMIN): sem alertas? A "Última sincronização" deve ter
   poucos minutos. Alerta de rotina parada → verifique o `worker`/cron.
2. **Pagamentos**: trate as pendências (seção 4).
3. **Pedidos** com "Já paguei" (modo manual): confira o extrato (seção 5).
4. **Sistema → Logs**: filtre por `ERROR`/`CRITICAL` e `SECURITY`.
5. Reenvie confirmações por WhatsApp quando o comprador pedir (**Pedido →
   Reenviar confirmação** gera o texto e o link; o envio é feito por você —
   não envie mensagens em massa).

## 4. Pendências de pagamento (Pagamentos)

O sistema **nunca** confirma um pedido com valor diferente, pagamento
duplicado ou pagamento que chegou depois de os números serem vendidos a outra
pessoa. Esses casos ficam aqui:

| Situação | O que significa | O que fazer |
|---|---|---|
| `PAYMENT_AMOUNT_MISMATCH` | pagou valor diferente do pedido (ex.: R$ 4,90 em pedido de R$ 49,00) | falar com o comprador; devolver o valor pelo Mercado Pago; se ele quiser, fazer novo pedido pelo valor certo |
| Pagamento duplicado | pagou duas vezes o mesmo pedido | devolver o pagamento extra |
| Pagamento tardio com conflito | pagou depois da expiração e algum número já foi vendido | devolver o valor; oferecer outros números em novo pedido |
| Estorno/reembolso no gateway | o gateway informou devolução | conferir; os números desse pedido deixam de participar |

Depois de agir, use **Registrar tratamento** com uma observação (e marque
"devolvido" quando for o caso). Tudo fica na auditoria.

## 5. Pix manual (chave estática)

Quando o comprador clica em "Já paguei", o pedido **continua pendente** — o
aviso só entra na sua fila. Para confirmar:

1. Abra o extrato da conta que recebe na chave `13786508917`.
2. Localize o Pix: **valor igual ao do pedido**, horário compatível, nome do
   pagador. Na dúvida, não confirme — fale com o comprador.
3. No pedido: **Confirmar pagamento manualmente** → diálogo "Você verificou o
   pagamento na conta?" → informe o valor identificado, a referência do
   extrato (ID/horário/nome) e o motivo → marque "Verifiquei o pagamento na
   conta de recebimento" → **Confirmar pagamento**.
4. Valor menor que o total é recusado e registrado. Pedido do modo automático
   não pode ser confirmado à mão (use **Verificar no gateway agora**).

Comprovante, print ou mensagem nunca são prova suficiente sozinhos.

## 6. Atendimento

| Pedido do comprador | Como resolver |
|---|---|
| "Perdi o QR Code / fechei o navegador" | `/consultar` com código do pedido + WhatsApp, ou o link do pedido em **Reenviar confirmação** |
| "Paguei e não confirmou" (automático) | no pedido, **Verificar no gateway agora**; se aprovado, confirma na hora. Se o gateway ainda diz pendente, peça para aguardar alguns minutos |
| "Digitei meu nome/telefone errado" | **Corrigir dados** (motivo obrigatório; pedidos pagos mantêm histórico na auditoria) |
| "Quero trocar números" | pedido pendente: cancelar e fazer outro. Pedido pago: não há troca silenciosa — só com reembolso (ADMIN) e novo pedido |
| "Quero reservar para alguém" | **Pedidos → Reservar números para um comprador** (Pix manual, com aceite declarado do comprador) |
| Acesso aos dados (LGPD) | **Compradores → (titular) → Exportar dados do titular (LGPD)** |
| Correção (LGPD) | **Corrigir cadastro** (auditado) |
| Exclusão (LGPD) | **Anonimizar** (ADMIN). Bloqueado enquanto houver pedido pendente, participação em sorteio não realizado ou prêmio a entregar; valores, números e datas são mantidos para prestação de contas |

Retenção automática: quem nunca concluiu uma compra é anonimizado após 90
dias. Logs informativos são apagados após 60 dias; demais logs após 365 dias.

## 7. Números

- **Bloquear/Desbloquear** (ADMIN, com motivo): tira um número disponível da
  venda (ex.: reservado para evento).
- **Liberar reserva** (operador): libera reserva de carrinho travada.
- Número pago **não** volta a ficar disponível. Só um reembolso auditado
  (ADMIN) o retira do sorteio.

## 8. Encerramento e sorteio

1. **Configurações → Campanha → Encerrar vendas** (ou aguarde a data final).
2. Aguarde a expiração dos pedidos pendentes (ou confirme/cancele-os) e trate
   todas as pendências de pagamento. Em `/status`, rode **Conciliar pagamentos
   agora**.
3. Faça um backup (docs/BACKUP.md).
4. **Sorteio → Congelar vendas e publicar lista**: informe a referência
   oficial (ex.: "Loteria Federal, extração nº X de DD/MM/AAAA") e a data/hora
   do evento (precisa ser futura). A lista e o hash ficam públicos em
   `/campanha/alek/resultado` — divulgue esse link antes do resultado.
5. Depois do evento oficial: **Apuração** — digite o resultado oficial duas
   vezes, clique em **Conferir cálculo** (não grava nada), confira com a
   fonte oficial e clique em **Registrar resultado oficial**.
6. Confira o passo a passo e clique em **Homologar resultado**. A campanha
   passa a "Sorteio realizado" e o resultado é publicado (somente números).
7. Se a referência oficial for cancelada/adiada, ou se o resultado foi
   digitado errado, use **Anular sorteio** antes de homologar (o motivo fica
   público) e crie um novo sorteio sobre a mesma lista.
8. Guarde o **Relatório para impressão** (salve em PDF) e o **Relatório
   (JSON)**.

## 9. Entrega dos prêmios

No resultado homologado, para cada prêmio: **Chamar no WhatsApp**, depois
registre a situação (Contatado → Entregue, ou Falha na entrega) com
observações e, se houver, link do comprovante. Não publique dados pessoais do
vencedor.

## 10. Incidentes

| Sintoma | Causa provável | Ação |
|---|---|---|
| `/status`: "Rotina … sem execução recente" | worker/cron parado | reinicie o `worker`; pedidos vencidos serão tratados na próxima execução |
| Pagamentos automáticos não confirmam | webhook com segredo errado ou URL errada | `/status` → "Último inválido"; confira `PAYMENT_WEBHOOK_SECRET` e a URL; a conciliação continua confirmando a cada 60 s |
| Gateway fora do ar | indisponibilidade externa | nada a fazer: reservas são mantidas (o sistema prefere segurar a vender em dobro); após a volta, a conciliação ajusta |
| Muitos `429`/`SECURITY` nos logs | abuso ou robô | os limites já bloqueiam; se persistir, bloqueie o IP no proxy/firewall |
| "Cadeia de auditoria quebrada" | alteração direta no banco | isole o acesso ao banco, restaure/compare com backup, investigue |
| Banco indisponível | falha de infraestrutura | docs/BACKUP.md, seção 4 |
