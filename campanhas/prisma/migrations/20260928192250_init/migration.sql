-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'FROZEN', 'DRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "number_status" AS ENUM ('AVAILABLE', 'RESERVED', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'DRAWN', 'WINNER');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'ERROR');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "payment_gateway" AS ENUM ('MERCADO_PAGO', 'STATIC_PIX');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('CREATING', 'PENDING', 'APPROVED', 'AMOUNT_MISMATCH', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'CHARGED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "payment_event_source" AS ENUM ('WEBHOOK', 'RECONCILIATION', 'STATUS_CHECK', 'EXPIRATION_JOB', 'MANUAL', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "event_processing_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED', 'DUPLICATE', 'REJECTED');

-- CreateEnum
CREATE TYPE "prize_origin" AS ENUM ('NOT_INFORMED', 'DONATION', 'PURCHASED', 'SPONSORSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "draw_method" AS ENUM ('FEDERAL_LOTTERY', 'VERIFIABLE_HASH', 'CSPRNG');

-- CreateEnum
CREATE TYPE "draw_status" AS ENUM ('SNAPSHOT_CREATED', 'EXECUTED', 'FINALIZED', 'FAILED');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDING_CONTACT', 'CONTACTED', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'SYSTEM', 'CUSTOMER', 'GATEWAY');

-- CreateEnum
CREATE TYPE "log_level" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "pix_key_type" AS ENUM ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP');

-- CreateEnum
CREATE TYPE "gateway_environment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "story" TEXT NOT NULL DEFAULT '',
    "image_url" TEXT,
    "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
    "total_numbers" INTEGER NOT NULL,
    "first_number" INTEGER NOT NULL DEFAULT 1,
    "number_digits" INTEGER NOT NULL DEFAULT 4,
    "price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "min_numbers_per_order" INTEGER NOT NULL DEFAULT 1,
    "max_numbers_per_order" INTEGER NOT NULL DEFAULT 100,
    "max_numbers_per_customer" INTEGER,
    "reservation_minutes" INTEGER NOT NULL DEFAULT 10,
    "payment_minutes" INTEGER NOT NULL DEFAULT 30,
    "order_code_prefix" TEXT NOT NULL,
    "require_cpf" BOOLEAN NOT NULL DEFAULT false,
    "require_email" BOOLEAN NOT NULL DEFAULT false,
    "sales_start_at" TIMESTAMPTZ(3),
    "sales_end_at" TIMESTAMPTZ(3),
    "draw_scheduled_at" TIMESTAMPTZ(3),
    "draw_method" "draw_method",
    "draw_method_params" JSONB,
    "contact_whatsapp" TEXT,
    "contact_email" TEXT,
    "contact_instagram" TEXT,
    "faq" JSONB NOT NULL DEFAULT '[]',
    "compliance_confirmed_at" TIMESTAMPTZ(3),
    "compliance_confirmed_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_numbers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "number_status" NOT NULL DEFAULT 'AVAILABLE',
    "reservation_id" UUID,
    "order_id" UUID,
    "reserved_until" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "blocked_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prizes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "estimated_value_cents" INTEGER,
    "origin" "prize_origin" NOT NULL DEFAULT 'NOT_INFORMED',
    "origin_details" TEXT,
    "documentation_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_information" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "operator_name" TEXT,
    "entity_name" TEXT,
    "cnpj" TEXT,
    "authorization_number" TEXT,
    "regulation" TEXT,
    "regulation_url" TEXT,
    "start_date" TIMESTAMPTZ(3),
    "end_date" TIMESTAMPTZ(3),
    "modality" TEXT,
    "official_draw_method" TEXT,
    "additional_info" TEXT,
    "privacy_contact" TEXT,
    "show_on_public_page" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_information_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "mode" "payment_mode" NOT NULL DEFAULT 'MANUAL',
    "pix_key_type" "pix_key_type" NOT NULL,
    "pix_key" TEXT NOT NULL,
    "receiver_name" TEXT NOT NULL,
    "receiver_city" TEXT NOT NULL,
    "gateway" "payment_gateway",
    "environment" "gateway_environment" NOT NULL DEFAULT 'SANDBOX',
    "api_key_encrypted" TEXT,
    "api_key_hint" TEXT,
    "webhook_secret_encrypted" TEXT,
    "webhook_secret_hint" TEXT,
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "quantity" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "order_id" UUID,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "cpf_encrypted" TEXT,
    "cpf_hash" TEXT,
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payment_mode" "payment_mode" NOT NULL,
    "gateway" "payment_gateway" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_email" TEXT,
    "access_token_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reservation_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "paid_payment_id" UUID,
    "expired_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "refunded_at" TIMESTAMPTZ(3),
    "customer_reported_paid_at" TIMESTAMPTZ(3),
    "customer_payment_note" TEXT,
    "terms_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "privacy_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "terms_version" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "created_by_user_id" UUID,
    "ip_hash" TEXT,
    "last_status_check_at" TIMESTAMPTZ(3),
    "confirmation_sent_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "campaign_number_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "gateway" "payment_gateway" NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "status" "payment_status" NOT NULL,
    "gateway_payment_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_amount_cents" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "pix_copy_paste" TEXT,
    "ticket_url" TEXT,
    "expires_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "gateway_status" TEXT,
    "gateway_status_detail" TEXT,
    "last_checked_at" TIMESTAMPTZ(3),
    "check_count" INTEGER NOT NULL DEFAULT 0,
    "creation_attempts" INTEGER NOT NULL DEFAULT 0,
    "creation_started_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "confirmation_source" "payment_event_source",
    "confirmed_by_id" UUID,
    "manual_reference" TEXT,
    "requires_attention" BOOLEAN NOT NULL DEFAULT false,
    "attention_reason" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolution_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID,
    "order_id" UUID,
    "gateway" "payment_gateway",
    "source" "payment_event_source" NOT NULL,
    "type" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "external_id" TEXT,
    "processing_status" "event_processing_status" NOT NULL,
    "signature_valid" BOOLEAN,
    "payload" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draws" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "status" "draw_status" NOT NULL DEFAULT 'SNAPSHOT_CREATED',
    "method" "draw_method" NOT NULL,
    "method_params" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "executed_by_id" UUID,
    "finalized_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_at" TIMESTAMPTZ(3),
    "finalized_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,

    CONSTRAINT "draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "draw_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligible_numbers_count" INTEGER NOT NULL,
    "eligible_numbers_hash" TEXT NOT NULL,
    "eligible_numbers" INTEGER[],
    "number_digits" INTEGER NOT NULL,
    "hash_algorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "canonical_format" TEXT NOT NULL,
    "official_method" "draw_method" NOT NULL,
    "official_method_description" TEXT NOT NULL,
    "official_reference" TEXT NOT NULL,
    "result" JSONB,
    "winner_number" INTEGER,
    "executed_at" TIMESTAMPTZ(3),

    CONSTRAINT "draw_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "draw_id" UUID NOT NULL,
    "prize_id" UUID NOT NULL,
    "prize_position" INTEGER NOT NULL,
    "input_value" TEXT NOT NULL,
    "derived_number" INTEGER,
    "winner_number" INTEGER NOT NULL,
    "campaign_number_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "computation" JSONB NOT NULL,
    "eligibility_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_status" "delivery_status" NOT NULL DEFAULT 'PENDING_CONTACT',
    "delivery_notes" TEXT,
    "contacted_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "delivery_proof_url" TEXT,
    "delivery_updated_at" TIMESTAMPTZ(3),
    "delivery_updated_by_id" UUID,

    CONSTRAINT "draw_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "campaign_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "log_level" NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "request_id" TEXT,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateTable
CREATE TABLE "system_state" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns"("slug");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaign_numbers_campaign_id_status_idx" ON "campaign_numbers"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_numbers_order_id_idx" ON "campaign_numbers"("order_id");

-- CreateIndex
CREATE INDEX "campaign_numbers_reservation_id_idx" ON "campaign_numbers"("reservation_id");

-- CreateIndex
CREATE INDEX "campaign_numbers_status_reserved_until_idx" ON "campaign_numbers"("status", "reserved_until");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_numbers_campaign_id_number_key" ON "campaign_numbers"("campaign_id", "number");

-- CreateIndex
CREATE INDEX "prizes_campaign_id_idx" ON "prizes"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_information_campaign_id_key" ON "legal_information"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_settings_campaign_id_key" ON "payment_settings"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_token_hash_key" ON "reservations"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_order_id_key" ON "reservations"("order_id");

-- CreateIndex
CREATE INDEX "reservations_status_expires_at_idx" ON "reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "reservations_campaign_id_idx" ON "reservations"("campaign_id");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_cpf_hash_idx" ON "customers"("cpf_hash");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_access_token_hash_key" ON "orders"("access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "orders_reservation_id_key" ON "orders"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paid_payment_id_key" ON "orders"("paid_payment_id");

-- CreateIndex
CREATE INDEX "orders_campaign_id_status_idx" ON "orders"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- CreateIndex
CREATE INDEX "orders_customer_phone_idx" ON "orders"("customer_phone");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "order_items_campaign_number_id_idx" ON "order_items"("campaign_number_id");

-- CreateIndex
CREATE INDEX "order_items_campaign_id_number_idx" ON "order_items"("campaign_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_campaign_number_id_key" ON "order_items"("order_id", "campaign_number_id");

-- CreateIndex
CREATE INDEX "order_notes_order_id_idx" ON "order_notes"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_requires_attention_idx" ON "payments"("requires_attention");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_gateway_payment_id_key" ON "payments"("gateway", "gateway_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_dedupe_key_key" ON "payment_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_idx" ON "payment_events"("payment_id");

-- CreateIndex
CREATE INDEX "payment_events_order_id_idx" ON "payment_events"("order_id");

-- CreateIndex
CREATE INDEX "payment_events_type_idx" ON "payment_events"("type");

-- CreateIndex
CREATE INDEX "payment_events_external_id_idx" ON "payment_events"("external_id");

-- CreateIndex
CREATE INDEX "payment_events_created_at_idx" ON "payment_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "draws_campaign_id_key" ON "draws"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "draw_snapshots_draw_id_key" ON "draw_snapshots"("draw_id");

-- CreateIndex
CREATE UNIQUE INDEX "draw_results_draw_id_prize_id_key" ON "draw_results"("draw_id", "prize_id");

-- CreateIndex
CREATE UNIQUE INDEX "draw_results_draw_id_winner_number_key" ON "draw_results"("draw_id", "winner_number");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_campaign_id_idx" ON "audit_logs"("campaign_id");

-- CreateIndex
CREATE INDEX "system_logs_created_at_idx" ON "system_logs"("created_at");

-- CreateIndex
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at");

-- CreateIndex
CREATE INDEX "system_logs_category_created_at_idx" ON "system_logs"("category", "created_at");

-- CreateIndex
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits"("window_start");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_numbers" ADD CONSTRAINT "campaign_numbers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_numbers" ADD CONSTRAINT "campaign_numbers_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_numbers" ADD CONSTRAINT "campaign_numbers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_information" ADD CONSTRAINT "legal_information_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_payment_id_fkey" FOREIGN KEY ("paid_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_campaign_number_id_fkey" FOREIGN KEY ("campaign_number_id") REFERENCES "campaign_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draws" ADD CONSTRAINT "draws_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draws" ADD CONSTRAINT "draws_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draws" ADD CONSTRAINT "draws_executed_by_id_fkey" FOREIGN KEY ("executed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draws" ADD CONSTRAINT "draws_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_snapshots" ADD CONSTRAINT "draw_snapshots_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_snapshots" ADD CONSTRAINT "draw_snapshots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "prizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_campaign_number_id_fkey" FOREIGN KEY ("campaign_number_id") REFERENCES "campaign_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_results" ADD CONSTRAINT "draw_results_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
