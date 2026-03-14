# Agent 7 Fortaleza: Launch & Verification Guide

This guide provides the exact steps to activate, seed, and test Agent 7 in your production environment.

## 1. Database Seeding (`v1_seller_identity_map`)
To link your existing Amazon sellers to their internal user profiles, run the newly created migration:
- **Migration**: `migrations/069_seed_seller_identity_map.sql`
- **What it does**: It takes the `amazon_seller_id` from your `users` table and populates the mapping table required for the Zero-Trust Paywall.

## 2. PayPal Webhook Configuration
Log in to your [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) and follow these steps:

1. **Select your App**: Open the REST API app you are using for the beta.
2. **Add Webhook**: Click "Add Webhook".
3. **Webhook URL**: You MUST use your **Node.js API URL** (not the Python one).
   - **Form**: `https://opside-node-api-woco.onrender.com/api/paypal-webhook/paypal`
   - *(Replace `opside-node-api-woco.onrender.com` with your actual Node Render service name if different)*.
4. **Event Types**: Select exactly `PAYMENT.SALE.COMPLETED`.
5. **Save**: Click Save.

> [!IMPORTANT]
> Agent 7 uses the "Penny Purge" protocol. It will ignore any payments that are not exactly `$99.00 USD`. Ensure your PayPal product price matches this exactly.

## 3. Alpha-First Run: Single Claim Test
To verify the entire pipe (Paywall -> Handshake -> Amazon Submission) without processing your entire queue, use **SINGLE_CASE_MODE**.

### Step-by-Step Testing:
1. **Find a Test Case**: Pick a UUID from `dispute_cases` where `filing_status = 'pending'`.
2. **Verify Payment**: Ensure the associated user has `is_paid_beta = true` in the `users` table.
3. **Set Environment Variable**:
   - On Render (Environment Settings): Set `SINGLE_CASE_MODE` to the `UUID` of your test case.
   - Or run locally: `SINGLE_CASE_MODE=your-uuid-here npm start`
4. **Monitor Logs**: Look for the `🚀 [AGENT 7] STARTING FULL SUBMISSION PROTOCOL` log entry.

## 4. Environment Checklist
Ensure these are set on Render or in your local `.env`:
- `ENABLE_REFUND_FILING_WORKER=true`: Enables the worker process.
- `agent7_filing_enabled=true`: Global toggle for Agent 7.

---
### IdentityBridge Verification
If you see `❌ [IDENTITY] Unmapped seller attempt` in your logs, it means the `merchant_token` (Seller ID) sent by Amazon is not in your `v1_seller_identity_map`. Run the seeding script again or manually add the map entry.
