-- Anulação auditada de apuração (antes da homologação) e novo sorteio.
--
-- * Um único sorteio "vivo" por campanha; sorteios anulados (FAILED) ficam no
--   histórico público com o motivo.
-- * EXECUTED -> FAILED só para métodos de entrada pública (Loteria Federal,
--   hash verificável): permite corrigir erro de digitação do resultado oficial
--   sem abrir espaço para "sortear de novo" com CSPRNG.
-- * Números DRAWN voltam a PAID apenas com a flag de transação
--   app.draw_operation = 'revert' (usada somente pela anulação).

DROP INDEX IF EXISTS "draws_campaign_id_key";
CREATE INDEX "draws_campaign_id_idx" ON "draws"("campaign_id");
CREATE UNIQUE INDEX "draws_one_live_per_campaign" ON "draws"("campaign_id") WHERE status <> 'FAILED';

CREATE OR REPLACE FUNCTION trg_campaign_numbers_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_campaign_status campaign_status;
  v_exceptional text := app_flag('app.exceptional_reason');
  v_draw_op text := app_flag('app.draw_operation');
  v_transition text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'AVAILABLE' OR EXISTS (SELECT 1 FROM order_items WHERE campaign_number_id = OLD.id) THEN
      RAISE EXCEPTION 'NUMBER_DELETE_FORBIDDEN: número % possui histórico ou não está disponível', OLD.number USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'AVAILABLE' THEN
      RAISE EXCEPTION 'NUMBER_INVALID_INITIAL_STATUS: número deve nascer AVAILABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.campaign_id <> OLD.campaign_id OR NEW.number <> OLD.number THEN
    RAISE EXCEPTION 'NUMBER_IDENTITY_IMMUTABLE: identidade do número é imutável' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = OLD.status THEN
    IF OLD.status IN ('PAID','DRAWN','WINNER')
       AND (NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
      RAISE EXCEPTION 'NUMBER_PAID_REASSIGN: número % já está pago e não pode trocar de pedido', OLD.number USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'PENDING_PAYMENT' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      RAISE EXCEPTION 'NUMBER_PENDING_REASSIGN: número % pertence a outro pedido', OLD.number USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'RESERVED' AND NEW.reservation_id IS DISTINCT FROM OLD.reservation_id THEN
      RAISE EXCEPTION 'NUMBER_RESERVED_REASSIGN: número % pertence a outra reserva', OLD.number USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  v_transition := OLD.status::text || '>' || NEW.status::text;

  -- Entradas em reserva/pagamento travam a campanha em modo compartilhado:
  -- serializa com fechar/congelar (que usam FOR UPDATE).
  IF NEW.status IN ('RESERVED','PENDING_PAYMENT') THEN
    SELECT status INTO v_campaign_status FROM campaigns WHERE id = NEW.campaign_id FOR SHARE;
  ELSE
    SELECT status INTO v_campaign_status FROM campaigns WHERE id = NEW.campaign_id;
  END IF;

  IF v_campaign_status IN ('FROZEN','DRAWN') THEN
    IF v_draw_op = 'on' AND v_transition IN ('PAID>DRAWN','DRAWN>WINNER') THEN
      RETURN NEW;
    END IF;
    -- Anulação de apuração ainda não homologada (ver trg_draws_guard).
    IF v_draw_op = 'revert' AND v_transition = 'DRAWN>PAID' AND v_campaign_status = 'FROZEN' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'NUMBER_CAMPAIGN_FROZEN: campanha congelada; número % não pode ir de % para %',
      OLD.number, OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;

  IF v_transition = 'AVAILABLE>RESERVED' THEN
    IF v_campaign_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'NUMBER_CAMPAIGN_NOT_ACTIVE: campanha não está com vendas abertas' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF v_transition = 'AVAILABLE>PENDING_PAYMENT' THEN
    IF v_campaign_status NOT IN ('ACTIVE','PAUSED','CLOSED') THEN
      RAISE EXCEPTION 'NUMBER_CAMPAIGN_NOT_ACTIVE: campanha não aceita pedidos' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF v_transition IN ('RESERVED>AVAILABLE', 'RESERVED>PENDING_PAYMENT',
                      'PENDING_PAYMENT>PAID', 'PENDING_PAYMENT>AVAILABLE') THEN
    RETURN NEW;
  END IF;

  IF v_transition IN ('AVAILABLE>CANCELLED', 'CANCELLED>AVAILABLE', 'PAID>CANCELLED') THEN
    IF v_exceptional = '' THEN
      RAISE EXCEPTION 'NUMBER_EXCEPTIONAL_REQUIRED: % exige operação excepcional auditada', v_transition USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- Inclui PAID>AVAILABLE, PAID>RESERVED, WINNER>*, DRAWN>PAID etc.
  RAISE EXCEPTION 'NUMBER_INVALID_TRANSITION: % não é permitido (número %)', v_transition, OLD.number USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION trg_draws_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_transition text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DRAW_DELETE_FORBIDDEN: sorteios não podem ser apagados' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SNAPSHOT_CREATED' THEN
      RAISE EXCEPTION 'DRAW_INVALID_INITIAL_STATUS: sorteio nasce com snapshot' USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT status FROM campaigns WHERE id = NEW.campaign_id) <> 'FROZEN' THEN
      RAISE EXCEPTION 'DRAW_CAMPAIGN_NOT_FROZEN: congele a campanha antes de criar o sorteio' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.campaign_id <> OLD.campaign_id OR NEW.method <> OLD.method
     OR NEW.method_params <> OLD.method_params OR NEW.created_at <> OLD.created_at
     OR NEW.created_by_id <> OLD.created_by_id THEN
    RAISE EXCEPTION 'DRAW_IMMUTABLE_FIELDS: método e parâmetros do sorteio são imutáveis' USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.executed_at IS NOT NULL AND NEW.executed_at IS DISTINCT FROM OLD.executed_at)
     OR (OLD.executed_by_id IS NOT NULL AND NEW.executed_by_id IS DISTINCT FROM OLD.executed_by_id)
     OR (OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at)
     OR (OLD.finalized_by_id IS NOT NULL AND NEW.finalized_by_id IS DISTINCT FROM OLD.finalized_by_id)
     OR (OLD.failed_at IS NOT NULL AND NEW.failed_at IS DISTINCT FROM OLD.failed_at)
     OR (OLD.failure_reason IS NOT NULL AND NEW.failure_reason IS DISTINCT FROM OLD.failure_reason) THEN
    RAISE EXCEPTION 'DRAW_IMMUTABLE_FIELDS: registros de execução são imutáveis' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_transition := OLD.status::text || '>' || NEW.status::text;
  IF v_transition NOT IN ('SNAPSHOT_CREATED>EXECUTED', 'EXECUTED>FINALIZED',
                          'SNAPSHOT_CREATED>FAILED', 'EXECUTED>FAILED') THEN
    RAISE EXCEPTION 'DRAW_INVALID_TRANSITION: % não é permitido', v_transition USING ERRCODE = 'P0001';
  END IF;

  -- Anulação: sempre com motivo. Depois da execução, só para métodos cuja
  -- entrada é pública e verificável (correção de digitação do resultado
  -- oficial); com CSPRNG, anular permitiria "sortear de novo".
  IF NEW.status = 'FAILED' THEN
    IF NEW.failed_at IS NULL OR length(trim(coalesce(NEW.failure_reason, ''))) < 10 THEN
      RAISE EXCEPTION 'DRAW_FAILURE_REASON_REQUIRED: anulação exige data e motivo' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'EXECUTED' AND OLD.method = 'CSPRNG' THEN
      RAISE EXCEPTION 'DRAW_CSPRNG_NOT_ANNULLABLE: apuração por CSPRNG executada não pode ser anulada' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'EXECUTED' AND EXISTS (
        SELECT 1 FROM draw_results r JOIN campaign_numbers n ON n.id = r.campaign_number_id
        WHERE r.draw_id = NEW.id AND n.status <> 'PAID') THEN
      RAISE EXCEPTION 'DRAW_REVERT_INCOMPLETE: números da apuração anulada devem voltar a PAID' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.status = 'EXECUTED' AND (NEW.executed_at IS NULL OR NEW.executed_by_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM draw_results WHERE draw_id = NEW.id)) THEN
    RAISE EXCEPTION 'DRAW_EXECUTION_INCOMPLETE: execução sem resultado registrado' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'FINALIZED' AND (NEW.finalized_at IS NULL OR NEW.finalized_by_id IS NULL
      OR EXISTS (SELECT 1 FROM draw_results WHERE draw_id = NEW.id AND eligibility_verified_at IS NULL)) THEN
    RAISE EXCEPTION 'DRAW_FINALIZATION_INCOMPLETE: vencedores não verificados' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;
