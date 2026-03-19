-- Migration: Rename Stripe columns to Whop equivalents
-- Safe to run multiple times (uses IF EXISTS checks)

-- meter_users: stripe_customer_id → whop_member_id, add whop_payment_method_id
ALTER TABLE meter_users RENAME COLUMN stripe_customer_id TO whop_member_id;
ALTER TABLE meter_users ADD COLUMN IF NOT EXISTS whop_payment_method_id text;

-- sdk_end_users: stripe_customer_id → whop_member_id, add whop_payment_method_id
ALTER TABLE sdk_end_users RENAME COLUMN stripe_customer_id TO whop_member_id;
ALTER TABLE sdk_end_users ADD COLUMN IF NOT EXISTS whop_payment_method_id text;

-- settlement_history: stripe_payment_intent_id → whop_payment_id
ALTER TABLE settlement_history RENAME COLUMN stripe_payment_intent_id TO whop_payment_id;
