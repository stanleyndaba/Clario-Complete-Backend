import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface BillingOwnerContext {
  tenantId: string;
  userId: string;
  sellerId: string;
}

export interface CreditApplicationResult {
  availableCreditCents: number;
  creditAppliedCents: number;
  amountDueCents: number;
  balanceAfterCents: number;
}

class BillingCreditService {
  async ensureActiveRecoveryCycle(
    context: BillingOwnerContext,
    provider: string = 'paypal'
  ): Promise<{ id: string }> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('recovery_cycles')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .eq('seller_id', context.sellerId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to lookup recovery cycle: ${existingError.message}`);
    }

    if (existing?.id) {
      return existing;
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from('recovery_cycles')
      .insert({
        tenant_id: context.tenantId,
        user_id: context.userId,
        seller_id: context.sellerId,
        provider,
        cycle_type: 'priority_recovery_cycle',
        cycle_window_days: null,
        status: 'active',
        metadata: {
          window_basis: 'set_when_dataset_scope_is_known'
        }
      })
      .select('id')
      .single();

    if (createError || !created?.id) {
      throw new Error(`Failed to create recovery cycle: ${createError?.message || 'unknown error'}`);
    }

    return created;
  }

  async getAvailableCreditBalanceCents(context: BillingOwnerContext): Promise<number> {
    const { data, error } = await supabaseAdmin
      .from('billing_credit_ledger')
      .select('transaction_type, amount_cents')
      .eq('tenant_id', context.tenantId)
      .eq('seller_id', context.sellerId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to read billing credit ledger: ${error.message}`);
    }

    return (data || []).reduce((balance, row) => {
      if (row.transaction_type === 'credit_added') return balance + (row.amount_cents || 0);
      if (row.transaction_type === 'credit_applied') return Math.max(0, balance - (row.amount_cents || 0));
      return balance;
    }, 0);
  }

  async recordPriorityPrepaidCredit(
    context: BillingOwnerContext,
    externalPaymentId: string,
    amountCents: number = 9900,
    provider: string = 'paypal'
  ): Promise<{ ledgerId: string; balanceAfterCents: number; recoveryCycleId: string }> {
    const recoveryCycle = await this.ensureActiveRecoveryCycle(context, provider);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('billing_credit_ledger')
      .select('id, balance_after_cents, recovery_cycle_id')
      .eq('tenant_id', context.tenantId)
      .eq('seller_id', context.sellerId)
      .eq('transaction_type', 'credit_added')
      .eq('external_payment_id', externalPaymentId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to check existing prepaid credit: ${existingError.message}`);
    }

    if (existing?.id) {
      return {
        ledgerId: existing.id,
        balanceAfterCents: existing.balance_after_cents || 0,
        recoveryCycleId: existing.recovery_cycle_id || recoveryCycle.id
      };
    }

    const currentBalance = await this.getAvailableCreditBalanceCents(context);
    const balanceAfterCents = currentBalance + amountCents;

    const { data: created, error: createError } = await supabaseAdmin
      .from('billing_credit_ledger')
      .insert({
        tenant_id: context.tenantId,
        user_id: context.userId,
        seller_id: context.sellerId,
        recovery_cycle_id: recoveryCycle.id,
        provider,
        transaction_type: 'credit_added',
        amount_cents: amountCents,
        balance_after_cents: balanceAfterCents,
        external_payment_id: externalPaymentId,
        metadata: {
          payment_type: 'priority_prepaid_credit'
        }
      })
      .select('id')
      .single();

    if (createError || !created?.id) {
      throw new Error(`Failed to persist prepaid credit: ${createError?.message || 'unknown error'}`);
    }

    logger.info('✅ [BILLING] Prepaid credit recorded', {
      sellerId: context.sellerId,
      tenantId: context.tenantId,
      amountCents,
      balanceAfterCents,
      recoveryCycleId: recoveryCycle.id
    });

    return {
      ledgerId: created.id,
      balanceAfterCents,
      recoveryCycleId: recoveryCycle.id
    };
  }

  async previewCreditApplication(
    context: BillingOwnerContext,
    platformFeeCents: number
  ): Promise<CreditApplicationResult> {
    const availableCreditCents = await this.getAvailableCreditBalanceCents(context);
    const creditAppliedCents = Math.min(platformFeeCents, availableCreditCents);
    const amountDueCents = Math.max(0, platformFeeCents - creditAppliedCents);
    const balanceAfterCents = Math.max(0, availableCreditCents - creditAppliedCents);

    return {
      availableCreditCents,
      creditAppliedCents,
      amountDueCents,
      balanceAfterCents
    };
  }

  async applyCreditToBilling(
    context: BillingOwnerContext,
    billingTransactionId: string,
    recoveryCycleId: string | null,
    creditAppliedCents: number,
    provider: string = 'paypal'
  ): Promise<{ balanceAfterCents: number }> {
    const availableCreditCents = await this.getAvailableCreditBalanceCents(context);
    const safeCreditApplied = Math.min(creditAppliedCents, availableCreditCents);
    const balanceAfterCents = Math.max(0, availableCreditCents - safeCreditApplied);

    if (safeCreditApplied <= 0) {
      return { balanceAfterCents: availableCreditCents };
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('billing_credit_ledger')
      .select('id, balance_after_cents')
      .eq('tenant_id', context.tenantId)
      .eq('seller_id', context.sellerId)
      .eq('billing_transaction_id', billingTransactionId)
      .eq('transaction_type', 'credit_applied')
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to check existing applied credit: ${existingError.message}`);
    }

    if (existing?.id) {
      return { balanceAfterCents: existing.balance_after_cents || balanceAfterCents };
    }

    const { error: insertError } = await supabaseAdmin
      .from('billing_credit_ledger')
      .insert({
        tenant_id: context.tenantId,
        user_id: context.userId,
        seller_id: context.sellerId,
        recovery_cycle_id: recoveryCycleId,
        billing_transaction_id: billingTransactionId,
        provider,
        transaction_type: 'credit_applied',
        amount_cents: safeCreditApplied,
        balance_after_cents: balanceAfterCents,
        metadata: {
          billing_transaction_id: billingTransactionId
        }
      });

    if (insertError) {
      throw new Error(`Failed to apply billing credit: ${insertError.message}`);
    }

    return { balanceAfterCents };
  }
}

export default new BillingCreditService();
