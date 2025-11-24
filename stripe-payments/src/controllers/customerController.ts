import { Request, Response } from 'express';
import StripeCustomerService from '@/services/stripeCustomerService';

export interface CustomerMapRequest {
  externalUserId: string;
  email: string;
}

export class CustomerController {
  /**
   * Maps an external Supabase UUID to a deterministic integer ID used internally.
   */
  static async mapCustomer(req: Request, res: Response) {
    const { externalUserId, email } = req.body as CustomerMapRequest;

    if (!externalUserId || !email) {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'externalUserId and email are required',
      });
    }

    try {
      const result = await StripeCustomerService.getOrCreateInternalCustomerId(
        externalUserId,
        email
      );

      return res.status(200).json({
        stripeCustomerId: result.id,
        isNew: result.isNew,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: 'customer_map_failed',
        message: error?.message || 'Failed to map customer',
      });
    }
  }
}

export default CustomerController;

