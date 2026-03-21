-- Migration: Rename Whop columns back to Stripe equivalents
-- Safe to run multiple times (uses exception handlers for missing columns)

-- meter_users: whop_member_id → stripe_customer_id, whop_payment_method_id → stripe_payment_method_id
DO $$ BEGIN ALTER TABLE meter_users RENAME COLUMN whop_member_id TO stripe_customer_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
ALTER TABLE meter_users ADD COLUMN IF NOT EXISTS stripe_customer_id text;
DO $$ BEGIN ALTER TABLE meter_users RENAME COLUMN whop_payment_method_id TO stripe_payment_method_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
ALTER TABLE meter_users ADD COLUMN IF NOT EXISTS stripe_payment_method_id text;

-- sdk_end_users: whop_member_id → stripe_customer_id, whop_payment_method_id → stripe_payment_method_id
DO $$ BEGIN ALTER TABLE sdk_end_users RENAME COLUMN whop_member_id TO stripe_customer_id; EXCEPTION WHEN undefined_column THEN NULL; WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE sdk_end_users ADD COLUMN IF NOT EXISTS stripe_customer_id text; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE sdk_end_users RENAME COLUMN whop_payment_method_id TO stripe_payment_method_id; EXCEPTION WHEN undefined_column THEN NULL; WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE sdk_end_users ADD COLUMN IF NOT EXISTS stripe_payment_method_id text; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- settlement_history: whop_payment_id → stripe_payment_intent_id
DO $$ BEGIN ALTER TABLE settlement_history RENAME COLUMN whop_payment_id TO stripe_payment_intent_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
ALTER TABLE settlement_history ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
