import { RECOVERY_WORKSPACE_ACTIVATION_PRODUCT } from '../config/paystackProducts';
import { withPostgresTransaction } from '../database/postgresTransaction';
import {
  getSafePaystackProviderData,
  PaystackVerifyData,
} from './paystackService';

export type ActivationResult = {
  payment: {
    reference: string;
    status: 'paid';
    amount_subunits: number;
    currency: string;
    paid_at: string | null;
    created_at?: string;
  };
  workspace: {
    activated: true;
    audit_run_id: string;
    activated_at: string | null;
  };
  alreadyActivated: boolean;
};

function assertVerifiedPaystackPayment(reference: string, providerData: PaystackVerifyData) {
  if (providerData.reference !== reference) {
    throw new Error('Paystack reference mismatch');
  }
  if (providerData.status !== 'success') {
    throw new Error(`Paystack transaction is not successful: ${providerData.status}`);
  }
  if (Number(providerData.amount) !== RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.amountSubunits) {
    throw new Error('Paystack amount mismatch');
  }
  if (String(providerData.currency || '').toUpperCase() !== RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.currency) {
    throw new Error('Paystack currency mismatch');
  }
}

export async function applyVerifiedPaystackActivation(
  reference: string,
  providerData: PaystackVerifyData,
  providerResponse: Record<string, unknown>
): Promise<ActivationResult> {
  assertVerifiedPaystackPayment(reference, providerData);

  return withPostgresTransaction(async (client) => {
    const paymentResult = await client.query(
      `
        SELECT *
        FROM payments
        WHERE reference = $1
        FOR UPDATE
      `,
      [reference]
    );

    const payment = paymentResult.rows[0];
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (
      payment.product_key !== RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.key ||
      Number(payment.amount_subunits) !== RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.amountSubunits ||
      String(payment.currency || '').toUpperCase() !== RECOVERY_WORKSPACE_ACTIVATION_PRODUCT.currency
    ) {
      throw new Error('Internal payment truth does not match product configuration');
    }

    if (!payment.audit_run_id) {
      throw new Error('Payment is not linked to an audit run');
    }

    if (payment.status === 'paid') {
      const auditResult = await client.query(
        `
          SELECT id, activation_status, activated_at
          FROM audit_runs
          WHERE id = $1
        `,
        [payment.audit_run_id]
      );
      const audit = auditResult.rows[0];
      if (audit?.activation_status !== 'activated') {
        throw new Error('Paid payment found without activated audit');
      }

      return {
        payment: {
          reference: payment.reference,
          status: 'paid',
          amount_subunits: payment.amount_subunits,
          currency: payment.currency,
          paid_at: payment.paid_at,
          created_at: payment.created_at,
        },
        workspace: {
          activated: true,
          audit_run_id: payment.audit_run_id,
          activated_at: audit.activated_at,
        },
        alreadyActivated: true,
      };
    }

    const paidAt = providerData.paid_at || new Date().toISOString();
    const verifiedAt = new Date().toISOString();
    const safeProviderResponse = {
      ...providerResponse,
      data: getSafePaystackProviderData(providerData),
    };

    const updatedPaymentResult = await client.query(
      `
        UPDATE payments
        SET status = 'paid',
            provider_transaction_id = $2,
            provider_status = $3,
            paid_at = $4,
            verified_at = $5,
            provider_response = $6::jsonb,
            updated_at = $5
        WHERE id = $1
        RETURNING *
      `,
      [
        payment.id,
        providerData.id ? String(providerData.id) : null,
        providerData.status,
        paidAt,
        verifiedAt,
        JSON.stringify(safeProviderResponse),
      ]
    );

    const updatedPayment = updatedPaymentResult.rows[0];
    if (!updatedPayment) {
      throw new Error('Failed to mark payment paid');
    }

    const updatedAuditResult = await client.query(
      `
        UPDATE audit_runs
        SET activation_status = 'activated',
            status = 'activated',
            activated_at = COALESCE(activated_at, $2),
            activated_by_payment_id = $3,
            updated_at = $2
        WHERE id = $1
          AND user_id = $4
          AND tenant_id = $5
        RETURNING id, activation_status, activated_at
      `,
      [payment.audit_run_id, verifiedAt, payment.id, payment.user_id, payment.tenant_id]
    );

    const updatedAudit = updatedAuditResult.rows[0];
    if (!updatedAudit || updatedAudit.activation_status !== 'activated') {
      throw new Error('Failed to activate audit workspace');
    }

    return {
      payment: {
        reference: updatedPayment.reference,
        status: 'paid',
        amount_subunits: updatedPayment.amount_subunits,
        currency: updatedPayment.currency,
        paid_at: updatedPayment.paid_at,
        created_at: updatedPayment.created_at,
      },
      workspace: {
        activated: true,
        audit_run_id: updatedAudit.id,
        activated_at: updatedAudit.activated_at,
      },
      alreadyActivated: false,
    };
  });
}
