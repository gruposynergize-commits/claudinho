-- =====================================================================
-- Migração de integridade
--
-- Regras que protegem os dados mesmo que a aplicação tenha um bug:
-- CHECKs, índices únicos parciais, triggers de transição de estado,
-- verificações de consistência no COMMIT e imutabilidade de histórico.
--
-- Operações excepcionais (bloquear/desbloquear número, reembolso, correção
-- de dados de pedido pago, alteração crítica de campanha com vendas) exigem
-- que a transação defina:
--     SELECT set_config('app.exceptional_reason', '<motivo>', true);
-- Operações do sorteio exigem:
--     SELECT set_config('app.draw_operation', 'on', true);
-- (is_local = true: vale somente para a transação corrente.)
--
-- Códigos das mensagens de erro (prefixo antes de ":") são tratados pela
-- aplicação em src/server/db-errors.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Utilitários
-- ---------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS order_code_seq AS BIGINT START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION app_flag(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting(p_name, true), '');
$$;

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := date_trunc('milliseconds', clock_timestamp());
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','campaigns','campaign_numbers','prizes','legal_information',
                           'payment_settings','reservations','customers','orders','payments','system_state']
  LOOP
    EXECUTE format('CREATE TRIGGER zz_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION trg_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DELETE_FORBIDDEN: registros de % não podem ser apagados', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END $$;

-- ---------------------------------------------------------------------
-- 1. CHECK constraints
-- ---------------------------------------------------------------------

ALTER TABLE users
  ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  ADD CONSTRAINT users_failed_logins_nonneg CHECK (failed_logins >= 0);

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_price_positive CHECK (price_cents > 0),
  ADD CONSTRAINT campaigns_total_numbers_range CHECK (total_numbers BETWEEN 1 AND 1000000),
  ADD CONSTRAINT campaigns_first_number_nonneg CHECK (first_number >= 0),
  ADD CONSTRAINT campaigns_number_digits_range CHECK (number_digits BETWEEN 1 AND 7),
  ADD CONSTRAINT campaigns_order_limits CHECK (min_numbers_per_order >= 1 AND max_numbers_per_order >= min_numbers_per_order AND max_numbers_per_order <= 10000),
  ADD CONSTRAINT campaigns_customer_limit CHECK (max_numbers_per_customer IS NULL OR max_numbers_per_customer >= 1),
  ADD CONSTRAINT campaigns_reservation_minutes CHECK (reservation_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT campaigns_payment_minutes CHECK (payment_minutes BETWEEN 1 AND 10080),
  ADD CONSTRAINT campaigns_currency_brl CHECK (currency = 'BRL'),
  ADD CONSTRAINT campaigns_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT campaigns_prefix_format CHECK (order_code_prefix ~ '^[A-Z0-9]{2,10}$'),
  ADD CONSTRAINT campaigns_sales_window CHECK (sales_start_at IS NULL OR sales_end_at IS NULL OR sales_end_at > sales_start_at);

ALTER TABLE campaign_numbers
  ADD CONSTRAINT campaign_numbers_number_nonneg CHECK (number >= 0),
  ADD CONSTRAINT campaign_numbers_state_coherence CHECK (
       (status = 'AVAILABLE'       AND order_id IS NULL     AND reservation_id IS NULL     AND reserved_until IS NULL     AND paid_at IS NULL)
    OR (status = 'RESERVED'        AND order_id IS NULL     AND reservation_id IS NOT NULL AND reserved_until IS NOT NULL AND paid_at IS NULL)
    OR (status = 'PENDING_PAYMENT' AND order_id IS NOT NULL AND reservation_id IS NULL     AND reserved_until IS NOT NULL AND paid_at IS NULL)
    OR (status IN ('PAID','DRAWN','WINNER') AND order_id IS NOT NULL AND reservation_id IS NULL AND paid_at IS NOT NULL)
    OR (status = 'CANCELLED'       AND reservation_id IS NULL)
  );

ALTER TABLE prizes
  ADD CONSTRAINT prizes_position_positive CHECK (position >= 1),
  ADD CONSTRAINT prizes_value_nonneg CHECK (estimated_value_cents IS NULL OR estimated_value_cents >= 0);

ALTER TABLE reservations
  ADD CONSTRAINT reservations_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT reservations_converted_has_order CHECK ((status = 'CONVERTED') = (order_id IS NOT NULL));

ALTER TABLE customers
  ADD CONSTRAINT customers_phone_format CHECK (phone ~ '^[0-9]{10,15}$' OR (anonymized_at IS NOT NULL AND phone LIKE 'anon-%')),
  ADD CONSTRAINT customers_name_not_blank CHECK (length(btrim(name)) > 0);

ALTER TABLE orders
  ADD CONSTRAINT orders_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT orders_unit_price_positive CHECK (unit_price_cents > 0),
  ADD CONSTRAINT orders_total_matches CHECK (total_cents = unit_price_cents * quantity),
  ADD CONSTRAINT orders_currency_brl CHECK (currency = 'BRL'),
  ADD CONSTRAINT orders_paid_coherence CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND paid_payment_id IS NOT NULL)),
  ADD CONSTRAINT orders_gateway_mode CHECK ((payment_mode = 'MANUAL') = (gateway = 'STATIC_PIX')),
  ADD CONSTRAINT orders_source CHECK (source IN ('WEB','ADMIN'));

ALTER TABLE order_items
  ADD CONSTRAINT order_items_price_positive CHECK (unit_price_cents > 0),
  ADD CONSTRAINT order_items_release_coherence CHECK ((active AND released_at IS NULL) OR (NOT active AND released_at IS NOT NULL));

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount_cents > 0),
  ADD CONSTRAINT payments_paid_amount_nonneg CHECK (paid_amount_cents IS NULL OR paid_amount_cents >= 0),
  ADD CONSTRAINT payments_currency_brl CHECK (currency = 'BRL'),
  ADD CONSTRAINT payments_approved_coherence CHECK (status <> 'APPROVED' OR (approved_at IS NOT NULL AND paid_amount_cents IS NOT NULL)),
  ADD CONSTRAINT payments_gateway_mode CHECK ((mode = 'MANUAL') = (gateway = 'STATIC_PIX')),
  ADD CONSTRAINT payments_manual_approval_has_user CHECK (mode <> 'MANUAL' OR status <> 'APPROVED' OR confirmed_by_id IS NOT NULL);

ALTER TABLE draw_snapshots
  ADD CONSTRAINT draw_snapshots_count_matches CHECK (eligible_numbers_count = cardinality(eligible_numbers)),
  ADD CONSTRAINT draw_snapshots_count_positive CHECK (eligible_numbers_count > 0),
  ADD CONSTRAINT draw_snapshots_hash_format CHECK (eligible_numbers_hash ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------
-- 2. Índices únicos parciais (redes de segurança)
-- ---------------------------------------------------------------------

-- Um número só pode pertencer a UM item de pedido ativo.
CREATE UNIQUE INDEX order_items_one_active_per_number ON order_items (campaign_number_id) WHERE active;

-- Um cliente ativo por telefone.
CREATE UNIQUE INDEX customers_phone_active_unique ON customers (phone) WHERE anonymized_at IS NULL;

-- Ordem de prêmio única entre prêmios não removidos.
CREATE UNIQUE INDEX prizes_position_active_unique ON prizes (campaign_id, position) WHERE deleted_at IS NULL;

-- No máximo uma cobrança aberta por pedido (impede cobrança duplicada).
CREATE UNIQUE INDEX payments_one_open_per_order ON payments (order_id) WHERE status IN ('CREATING','PENDING');

-- ---------------------------------------------------------------------
-- 3. Campanhas: transições de status e campos críticos
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_campaigns_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_exceptional text := app_flag('app.exceptional_reason');
  v_transition text;
  v_has_orders boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CAMPAIGN_DELETE_FORBIDDEN: campanhas não são apagadas (use deleted_at)' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'CAMPAIGN_INVALID_INITIAL_STATUS: campanha deve nascer como DRAFT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'CAMPAIGN_IMMUTABLE_FIELDS: identidade da campanha é imutável' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.first_number <> OLD.first_number AND EXISTS (SELECT 1 FROM campaign_numbers WHERE campaign_id = OLD.id) THEN
    RAISE EXCEPTION 'CAMPAIGN_NUMBERING_IMMUTABLE: numeração não pode mudar depois de criada' USING ERRCODE = 'P0001';
  END IF;

  v_has_orders := EXISTS (SELECT 1 FROM orders WHERE campaign_id = OLD.id);

  IF NEW.order_code_prefix <> OLD.order_code_prefix AND v_has_orders THEN
    RAISE EXCEPTION 'CAMPAIGN_PREFIX_IMMUTABLE: prefixo não pode mudar depois do primeiro pedido' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status IN ('FROZEN','DRAWN','CANCELLED') AND (
       NEW.price_cents <> OLD.price_cents
    OR NEW.total_numbers <> OLD.total_numbers
    OR NEW.number_digits <> OLD.number_digits
    OR NEW.draw_method IS DISTINCT FROM OLD.draw_method
    OR NEW.draw_method_params IS DISTINCT FROM OLD.draw_method_params) THEN
    RAISE EXCEPTION 'CAMPAIGN_FROZEN_FIELDS: campanha % não permite alterar preço, quantidade ou método', OLD.status USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.price_cents <> OLD.price_cents OR NEW.total_numbers < OLD.total_numbers)
     AND v_has_orders AND v_exceptional = '' THEN
    RAISE EXCEPTION 'CAMPAIGN_CRITICAL_CHANGE_REQUIRES_CONFIRMATION: alteração crítica com vendas exige confirmação' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_transition := OLD.status::text || '>' || NEW.status::text;

  IF v_transition NOT IN (
      'DRAFT>ACTIVE', 'ACTIVE>PAUSED', 'PAUSED>ACTIVE', 'ACTIVE>CLOSED', 'PAUSED>CLOSED',
      'CLOSED>ACTIVE', 'CLOSED>FROZEN', 'FROZEN>DRAWN',
      'DRAFT>CANCELLED', 'ACTIVE>CANCELLED', 'PAUSED>CANCELLED', 'CLOSED>CANCELLED') THEN
    RAISE EXCEPTION 'CAMPAIGN_INVALID_TRANSITION: % não é permitido', v_transition USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'ACTIVE' AND NEW.compliance_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'CAMPAIGN_COMPLIANCE_REQUIRED: ativação exige declaração de conformidade' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'CANCELLED' AND EXISTS (SELECT 1 FROM orders WHERE campaign_id = OLD.id AND status = 'PAID') THEN
    RAISE EXCEPTION 'CAMPAIGN_HAS_PAID_ORDERS: há pedidos pagos; trate os reembolsos antes de cancelar' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'FROZEN' AND EXISTS (
      SELECT 1 FROM campaign_numbers WHERE campaign_id = OLD.id AND status IN ('RESERVED','PENDING_PAYMENT')) THEN
    RAISE EXCEPTION 'CAMPAIGN_HAS_PENDING_NUMBERS: existem números reservados/aguardando pagamento' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = 'DRAWN' AND NOT EXISTS (
      SELECT 1 FROM draws WHERE campaign_id = OLD.id AND status = 'FINALIZED') THEN
    RAISE EXCEPTION 'CAMPAIGN_DRAW_NOT_FINALIZED: sorteio não homologado' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER campaigns_guard BEFORE INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION trg_campaigns_guard();

-- ---------------------------------------------------------------------
-- 4. Números: máquina de estados
-- ---------------------------------------------------------------------

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

CREATE TRIGGER campaign_numbers_guard BEFORE INSERT OR UPDATE OR DELETE ON campaign_numbers
  FOR EACH ROW EXECUTE FUNCTION trg_campaign_numbers_guard();

-- ---------------------------------------------------------------------
-- 5. Pedidos: transições e campos imutáveis
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_orders_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_exceptional text := app_flag('app.exceptional_reason');
  v_transition text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ORDER_DELETE_FORBIDDEN: pedidos não podem ser apagados' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_PAYMENT' THEN
      RAISE EXCEPTION 'ORDER_INVALID_INITIAL_STATUS: pedido deve nascer PENDING_PAYMENT' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.code <> OLD.code OR NEW.campaign_id <> OLD.campaign_id
     OR NEW.customer_id <> OLD.customer_id OR NEW.quantity <> OLD.quantity
     OR NEW.unit_price_cents <> OLD.unit_price_cents OR NEW.total_cents <> OLD.total_cents
     OR NEW.currency <> OLD.currency OR NEW.payment_mode <> OLD.payment_mode
     OR NEW.gateway <> OLD.gateway OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.created_at <> OLD.created_at OR NEW.terms_accepted_at <> OLD.terms_accepted_at
     OR NEW.privacy_accepted_at <> OLD.privacy_accepted_at OR NEW.terms_version <> OLD.terms_version THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE_FIELDS: valores, cliente e identificação do pedido são imutáveis' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.paid_payment_id IS NOT NULL AND NEW.paid_payment_id IS DISTINCT FROM OLD.paid_payment_id THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_IMMUTABLE: pagamento confirmador não pode ser trocado' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status IN ('PAID','REFUNDED') AND v_exceptional = '' AND (
       NEW.customer_name IS DISTINCT FROM OLD.customer_name
    OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
    OR NEW.customer_email IS DISTINCT FROM OLD.customer_email) THEN
    RAISE EXCEPTION 'ORDER_PAID_CHANGE_REQUIRES_EXCEPTION: correção de pedido pago exige motivo auditado' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_transition := OLD.status::text || '>' || NEW.status::text;

  IF v_transition IN ('PENDING_PAYMENT>PAID', 'PENDING_PAYMENT>EXPIRED', 'PENDING_PAYMENT>CANCELLED',
                      'PENDING_PAYMENT>ERROR', 'EXPIRED>PAID', 'CANCELLED>PAID', 'ERROR>PAID',
                      'ERROR>CANCELLED') THEN
    RETURN NEW;
  END IF;

  IF v_transition = 'PAID>REFUNDED' THEN
    IF v_exceptional = '' THEN
      RAISE EXCEPTION 'ORDER_EXCEPTIONAL_REQUIRED: reembolso exige operação excepcional auditada' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'ORDER_INVALID_TRANSITION: % não é permitido', v_transition USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER orders_guard BEFORE INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_orders_guard();

-- ---------------------------------------------------------------------
-- 6. Itens de pedido: coerência e imutabilidade
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_order_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_number_campaign uuid;
  v_number int;
  v_order_campaign uuid;
  v_order_price int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ORDER_ITEM_DELETE_FORBIDDEN: itens de pedido não podem ser apagados' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT campaign_id, number INTO v_number_campaign, v_number FROM campaign_numbers WHERE id = NEW.campaign_number_id;
    SELECT campaign_id, unit_price_cents INTO v_order_campaign, v_order_price FROM orders WHERE id = NEW.order_id;
    IF v_number_campaign IS DISTINCT FROM NEW.campaign_id OR v_number IS DISTINCT FROM NEW.number
       OR v_order_campaign IS DISTINCT FROM NEW.campaign_id OR v_order_price IS DISTINCT FROM NEW.unit_price_cents THEN
      RAISE EXCEPTION 'ORDER_ITEM_MISMATCH: item não corresponde ao número/pedido' USING ERRCODE = 'P0001';
    END IF;
    IF NOT NEW.active THEN
      RAISE EXCEPTION 'ORDER_ITEM_INVALID_INITIAL_STATE: item deve nascer ativo' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.order_id <> OLD.order_id OR NEW.campaign_number_id <> OLD.campaign_number_id
     OR NEW.campaign_id <> OLD.campaign_id OR NEW.number <> OLD.number
     OR NEW.unit_price_cents <> OLD.unit_price_cents OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ORDER_ITEM_IMMUTABLE: item de pedido é imutável' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER order_items_guard BEFORE INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION trg_order_items_guard();

-- ---------------------------------------------------------------------
-- 7. Pagamentos: campos imutáveis e regressões proibidas
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_payments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAYMENT_DELETE_FORBIDDEN: pagamentos não podem ser apagados' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.order_id <> OLD.order_id OR NEW.amount_cents <> OLD.amount_cents
     OR NEW.gateway <> OLD.gateway OR NEW.mode <> OLD.mode OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.currency <> OLD.currency OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'PAYMENT_IMMUTABLE_FIELDS: valor, pedido e identificação do pagamento são imutáveis' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.gateway_payment_id IS NOT NULL AND NEW.gateway_payment_id IS DISTINCT FROM OLD.gateway_payment_id THEN
    RAISE EXCEPTION 'PAYMENT_GATEWAY_ID_IMMUTABLE: id do gateway não pode ser trocado' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED','REFUNDED','CHARGED_BACK') THEN
    RAISE EXCEPTION 'PAYMENT_INVALID_TRANSITION: pagamento aprovado não pode voltar para %', NEW.status USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'APPROVED' AND (NEW.paid_amount_cents IS DISTINCT FROM OLD.paid_amount_cents
                                 OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'PAYMENT_APPROVED_IMMUTABLE: valor/data de aprovação não podem mudar' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'AMOUNT_MISMATCH' AND NEW.status NOT IN ('AMOUNT_MISMATCH','REFUNDED','CHARGED_BACK') THEN
    RAISE EXCEPTION 'PAYMENT_INVALID_TRANSITION: pagamento com valor divergente não pode ser aprovado' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status IN ('REFUNDED','CHARGED_BACK') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'PAYMENT_INVALID_TRANSITION: pagamento estornado é final' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER payments_guard BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_guard();

-- ---------------------------------------------------------------------
-- 8. Consistência pedido × itens × números × pagamento (no COMMIT)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_order_consistency(p_order_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  o record;
  v_active_items int;
  v_numbers_total int;
  v_numbers_pending int;
  v_numbers_paid int;
  v_pay record;
BEGIN
  SELECT id, code, status, quantity, total_cents, paid_payment_id INTO o FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_active_items FROM order_items WHERE order_id = p_order_id AND active;
  SELECT count(*),
         count(*) FILTER (WHERE status = 'PENDING_PAYMENT'),
         count(*) FILTER (WHERE status IN ('PAID','DRAWN','WINNER'))
    INTO v_numbers_total, v_numbers_pending, v_numbers_paid
    FROM campaign_numbers WHERE order_id = p_order_id;

  IF o.status = 'PENDING_PAYMENT' THEN
    IF v_active_items <> o.quantity OR v_numbers_total <> o.quantity OR v_numbers_pending <> o.quantity THEN
      RAISE EXCEPTION 'ORDER_INCONSISTENT: pedido % pendente com itens=% números=% pendentes=% (esperado %)',
        o.code, v_active_items, v_numbers_total, v_numbers_pending, o.quantity USING ERRCODE = 'P0001';
    END IF;
  ELSIF o.status = 'PAID' THEN
    IF v_active_items <> o.quantity OR v_numbers_total <> o.quantity OR v_numbers_paid <> o.quantity THEN
      RAISE EXCEPTION 'ORDER_INCONSISTENT: pedido % pago com itens=% números=% pagos=% (esperado %)',
        o.code, v_active_items, v_numbers_total, v_numbers_paid, o.quantity USING ERRCODE = 'P0001';
    END IF;
    SELECT order_id, status, paid_amount_cents INTO v_pay FROM payments WHERE id = o.paid_payment_id;
    IF NOT FOUND OR v_pay.order_id <> o.id OR v_pay.status <> 'APPROVED'
       OR v_pay.paid_amount_cents IS NULL OR v_pay.paid_amount_cents < o.total_cents THEN
      RAISE EXCEPTION 'ORDER_PAYMENT_INVALID: pedido % marcado como pago sem pagamento aprovado de valor suficiente', o.code
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF o.status IN ('EXPIRED','CANCELLED','ERROR') THEN
    IF v_active_items <> 0 OR v_numbers_total <> 0 THEN
      RAISE EXCEPTION 'ORDER_INCONSISTENT: pedido % (%) ainda segura números (itens=% números=%)',
        o.code, o.status, v_active_items, v_numbers_total USING ERRCODE = 'P0001';
    END IF;
  ELSIF o.status = 'REFUNDED' THEN
    IF v_active_items <> 0 OR v_numbers_paid <> 0 THEN
      RAISE EXCEPTION 'ORDER_INCONSISTENT: pedido % reembolsado ainda possui números pagos', o.code USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_orders_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM check_order_consistency(NEW.id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER orders_consistency AFTER INSERT OR UPDATE ON orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_orders_consistency();

CREATE OR REPLACE FUNCTION trg_order_items_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM check_order_consistency(NEW.order_id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER order_items_consistency AFTER INSERT OR UPDATE ON order_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_order_items_consistency();

CREATE OR REPLACE FUNCTION trg_numbers_order_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    PERFORM check_order_consistency(NEW.order_id);
  END IF;
  IF OLD.order_id IS NOT NULL AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
    PERFORM check_order_consistency(OLD.order_id);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER campaign_numbers_order_consistency AFTER UPDATE ON campaign_numbers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN ((OLD.status IS DISTINCT FROM NEW.status OR OLD.order_id IS DISTINCT FROM NEW.order_id)
        AND (OLD.order_id IS NOT NULL OR NEW.order_id IS NOT NULL))
  EXECUTE FUNCTION trg_numbers_order_consistency();

-- ---------------------------------------------------------------------
-- 9. Sorteio: transições, snapshot imutável e resultados imutáveis
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draw_canonical_hash(p_numbers int[], p_digits int) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    coalesce((SELECT string_agg(lpad(n::text, p_digits, '0'), E'\n' ORDER BY n) FROM unnest(p_numbers) AS n), '') || E'\n',
    'UTF8')), 'hex');
$$;

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
     OR (OLD.finalized_by_id IS NOT NULL AND NEW.finalized_by_id IS DISTINCT FROM OLD.finalized_by_id) THEN
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

CREATE TRIGGER draws_guard BEFORE INSERT OR UPDATE OR DELETE ON draws
  FOR EACH ROW EXECUTE FUNCTION trg_draws_guard();

CREATE OR REPLACE FUNCTION trg_draw_snapshots_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_paid int[];
  v_campaign_status campaign_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SNAPSHOT_IMMUTABLE: snapshot do sorteio não pode ser apagado' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_campaign_status FROM campaigns WHERE id = NEW.campaign_id;
    IF v_campaign_status <> 'FROZEN' THEN
      RAISE EXCEPTION 'SNAPSHOT_CAMPAIGN_NOT_FROZEN: campanha precisa estar congelada' USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT campaign_id FROM draws WHERE id = NEW.draw_id) IS DISTINCT FROM NEW.campaign_id THEN
      RAISE EXCEPTION 'SNAPSHOT_MISMATCH: sorteio e campanha não correspondem' USING ERRCODE = 'P0001';
    END IF;
    -- A lista precisa ser exatamente os números pagos neste momento, em ordem.
    SELECT coalesce(array_agg(number ORDER BY number), '{}') INTO v_paid
      FROM campaign_numbers WHERE campaign_id = NEW.campaign_id AND status = 'PAID';
    IF NEW.eligible_numbers IS DISTINCT FROM v_paid THEN
      RAISE EXCEPTION 'SNAPSHOT_LIST_MISMATCH: lista elegível difere dos números pagos' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.eligible_numbers_hash <> draw_canonical_hash(NEW.eligible_numbers, NEW.number_digits) THEN
      RAISE EXCEPTION 'SNAPSHOT_HASH_MISMATCH: hash informado não confere com a lista' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.result IS NOT NULL OR NEW.winner_number IS NOT NULL OR NEW.executed_at IS NOT NULL THEN
      RAISE EXCEPTION 'SNAPSHOT_RESULT_ON_CREATE: resultado não pode existir na criação' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.draw_id <> OLD.draw_id OR NEW.campaign_id <> OLD.campaign_id
     OR NEW.created_at <> OLD.created_at OR NEW.eligible_numbers_count <> OLD.eligible_numbers_count
     OR NEW.eligible_numbers_hash <> OLD.eligible_numbers_hash OR NEW.eligible_numbers <> OLD.eligible_numbers
     OR NEW.number_digits <> OLD.number_digits OR NEW.hash_algorithm <> OLD.hash_algorithm
     OR NEW.canonical_format <> OLD.canonical_format OR NEW.official_method <> OLD.official_method
     OR NEW.official_method_description <> OLD.official_method_description
     OR NEW.official_reference <> OLD.official_reference THEN
    RAISE EXCEPTION 'SNAPSHOT_IMMUTABLE: snapshot do sorteio não pode ser alterado' USING ERRCODE = 'P0001';
  END IF;

  IF (OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result)
     OR (OLD.winner_number IS NOT NULL AND NEW.winner_number IS DISTINCT FROM OLD.winner_number)
     OR (OLD.executed_at IS NOT NULL AND NEW.executed_at IS DISTINCT FROM OLD.executed_at) THEN
    RAISE EXCEPTION 'SNAPSHOT_RESULT_IMMUTABLE: resultado já registrado não pode ser alterado' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.winner_number IS NOT NULL AND NOT (NEW.winner_number = ANY (NEW.eligible_numbers)) THEN
    RAISE EXCEPTION 'SNAPSHOT_WINNER_NOT_ELIGIBLE: vencedor fora da lista elegível' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER draw_snapshots_guard BEFORE INSERT OR UPDATE OR DELETE ON draw_snapshots
  FOR EACH ROW EXECUTE FUNCTION trg_draw_snapshots_guard();

CREATE OR REPLACE FUNCTION trg_draw_results_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_draw_status draw_status;
  v_draw_campaign uuid;
  v_eligible int[];
  v_num record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DRAW_RESULT_IMMUTABLE: resultado não pode ser apagado' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT d.status, d.campaign_id, s.eligible_numbers INTO v_draw_status, v_draw_campaign, v_eligible
      FROM draws d JOIN draw_snapshots s ON s.draw_id = d.id WHERE d.id = NEW.draw_id;
    IF v_draw_status IS DISTINCT FROM 'SNAPSHOT_CREATED' THEN
      RAISE EXCEPTION 'DRAW_RESULT_LOCKED: resultados só podem ser registrados na execução' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (NEW.winner_number = ANY (v_eligible)) THEN
      RAISE EXCEPTION 'DRAW_RESULT_NOT_ELIGIBLE: número % não está no snapshot', NEW.winner_number USING ERRCODE = 'P0001';
    END IF;
    SELECT campaign_id, number, order_id, status INTO v_num FROM campaign_numbers WHERE id = NEW.campaign_number_id;
    IF v_num.campaign_id IS DISTINCT FROM v_draw_campaign OR v_num.number IS DISTINCT FROM NEW.winner_number
       OR v_num.order_id IS DISTINCT FROM NEW.order_id OR v_num.status NOT IN ('PAID','DRAWN') THEN
      RAISE EXCEPTION 'DRAW_RESULT_MISMATCH: número vencedor não corresponde ao registro pago' USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT campaign_id FROM prizes WHERE id = NEW.prize_id) IS DISTINCT FROM v_draw_campaign THEN
      RAISE EXCEPTION 'DRAW_RESULT_MISMATCH: prêmio não pertence à campanha' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.draw_id <> OLD.draw_id OR NEW.prize_id <> OLD.prize_id
     OR NEW.prize_position <> OLD.prize_position OR NEW.input_value <> OLD.input_value
     OR NEW.derived_number IS DISTINCT FROM OLD.derived_number OR NEW.winner_number <> OLD.winner_number
     OR NEW.campaign_number_id <> OLD.campaign_number_id OR NEW.order_id <> OLD.order_id
     OR NEW.computation <> OLD.computation OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'DRAW_RESULT_IMMUTABLE: vencedor e cálculo não podem ser alterados' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.eligibility_verified_at IS NOT NULL AND NEW.eligibility_verified_at IS DISTINCT FROM OLD.eligibility_verified_at THEN
    RAISE EXCEPTION 'DRAW_RESULT_IMMUTABLE: verificação já registrada' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER draw_results_guard BEFORE INSERT OR UPDATE OR DELETE ON draw_results
  FOR EACH ROW EXECUTE FUNCTION trg_draw_results_guard();

-- ---------------------------------------------------------------------
-- 10. Auditoria: somente inserção + cadeia de hash
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_hash(p audit_logs, p_prev text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    coalesce(p_prev, ''),
    p.id::text,
    to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    p.actor_type::text,
    coalesce(p.actor_id::text, ''),
    p.actor_label,
    p.action,
    p.entity_type,
    coalesce(p.entity_id, ''),
    coalesce(p.campaign_id::text, ''),
    coalesce(p.before, 'null'::jsonb),
    coalesce(p.after, 'null'::jsonb),
    coalesce(p.reason, ''),
    coalesce(p.ip, ''),
    coalesce(p.user_agent, '')
  )::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION trg_audit_logs_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prev text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'AUDIT_APPEND_ONLY: auditoria não pode ser alterada nem apagada' USING ERRCODE = 'P0001';
  END IF;
  -- Serializa inserções para que a ordem da cadeia seja a ordem dos ids.
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs_chain'));
  NEW.id := nextval(pg_get_serial_sequence('audit_logs', 'id'));
  NEW.created_at := date_trunc('milliseconds', coalesce(NEW.created_at, clock_timestamp()));
  SELECT hash INTO v_prev FROM audit_logs ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := v_prev;
  NEW.hash := audit_log_hash(NEW, v_prev);
  RETURN NEW;
END $$;

CREATE TRIGGER audit_logs_chain BEFORE INSERT OR UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION trg_audit_logs_chain();

CREATE OR REPLACE FUNCTION trg_forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE_FORBIDDEN: % não pode ser truncada', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION trg_forbid_truncate();
CREATE TRIGGER draw_snapshots_no_truncate BEFORE TRUNCATE ON draw_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION trg_forbid_truncate();
CREATE TRIGGER draw_results_no_truncate BEFORE TRUNCATE ON draw_results
  FOR EACH STATEMENT EXECUTE FUNCTION trg_forbid_truncate();

CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE (ok boolean, checked bigint, first_broken_id bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_logs;
  v_prev text := NULL;
  v_count bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_logs ORDER BY id LOOP
    v_count := v_count + 1;
    IF r.prev_hash IS DISTINCT FROM v_prev OR r.hash <> audit_log_hash(r, v_prev) THEN
      RETURN QUERY SELECT false, v_count, r.id;
      RETURN;
    END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN QUERY SELECT true, v_count, NULL::bigint;
END $$;

-- ---------------------------------------------------------------------
-- 11. Outras tabelas históricas
-- ---------------------------------------------------------------------

-- Eventos de pagamento: somente campos de processamento podem mudar.
CREATE OR REPLACE FUNCTION trg_payment_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_IMMUTABLE: eventos não podem ser apagados' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id <> OLD.id OR NEW.source <> OLD.source OR NEW.type <> OLD.type
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR NEW.created_at <> OLD.created_at
     OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.signature_valid IS DISTINCT FROM OLD.signature_valid THEN
    RAISE EXCEPTION 'PAYMENT_EVENT_IMMUTABLE: conteúdo do evento é imutável' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_events_guard BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION trg_payment_events_guard();

-- Logs do sistema: sem edição (exclusão permitida apenas para retenção).
CREATE OR REPLACE FUNCTION trg_system_logs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SYSTEM_LOG_IMMUTABLE: logs não podem ser editados' USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER system_logs_guard BEFORE UPDATE ON system_logs
  FOR EACH ROW EXECUTE FUNCTION trg_system_logs_guard();

-- Clientes e notas: sem exclusão física (LGPD: anonimização).
CREATE TRIGGER customers_no_delete BEFORE DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
CREATE TRIGGER order_notes_no_delete BEFORE DELETE ON order_notes
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();
