import { prisma } from '@/prisma/client';

export interface InternalCustomerResult {
  id: number;
  isNew: boolean;
}

/**
 * Stripe Customer Service
 * Provides helpers for mapping external Supabase users to local integer IDs.
 */
export class StripeCustomerService {
  static async getOrCreateInternalCustomerId(
    externalUserId: string,
    email: string
  ): Promise<InternalCustomerResult> {
    // Attempt to find an existing mapping first
    const existing = await prisma.stripeCustomer.findUnique({
      where: { externalUserId },
      select: { id: true },
    });

    if (existing) {
      return { id: existing.id, isNew: false };
    }

    // Create a lightweight record that reserves the integer ID
    const created = await prisma.stripeCustomer.create({
      data: {
        externalUserId,
        email,
        stripeCustomerId: null,
      },
      select: { id: true },
    });

    return { id: created.id, isNew: true };
  }
}

export default StripeCustomerService;




