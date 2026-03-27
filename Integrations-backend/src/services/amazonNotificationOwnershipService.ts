import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

export interface NotificationOwnershipContext {
  tenantId?: string;
  storeId?: string;
  userId?: string;
  sellerId?: string;
  lineageResolution?: string;
  ambiguous?: boolean;
}

export interface NotificationOwnershipInput {
  amazonSubscriptionId?: string | null;
  amazonDestinationId?: string | null;
  sellerId?: string | null;
  marketplaceId?: string | null;
}

class AmazonNotificationOwnershipService {
  async resolveOwnership(input: NotificationOwnershipInput): Promise<NotificationOwnershipContext> {
    if (input.amazonSubscriptionId) {
      const binding = await this.resolveBySubscription(input.amazonSubscriptionId);
      if (binding) {
        return binding;
      }
    }

    if (input.sellerId) {
      return this.resolveBySeller(input.sellerId, input.marketplaceId || undefined, input.amazonSubscriptionId || undefined, input.amazonDestinationId || undefined);
    }

    return {};
  }

  private async resolveBySubscription(subscriptionId: string): Promise<NotificationOwnershipContext | null> {
    const { data, error } = await supabaseAdmin
      .from('amazon_notification_bindings')
      .select('tenant_id, store_id, user_id, seller_id')
      .eq('amazon_subscription_id', subscriptionId)
      .eq('is_active', true)
      .limit(2);

    if (error) {
      throw new Error(`Failed to resolve notification binding: ${error.message}`);
    }

    if (!data || data.length !== 1) {
      return null;
    }

    const binding = data[0] as any;
    return {
      tenantId: binding.tenant_id || undefined,
      storeId: binding.store_id || undefined,
      userId: binding.user_id || undefined,
      sellerId: binding.seller_id || undefined,
      lineageResolution: 'binding.subscription'
    };
  }

  private async resolveBySeller(
    sellerId: string,
    marketplaceId?: string,
    subscriptionId?: string,
    destinationId?: string
  ): Promise<NotificationOwnershipContext> {
    const { data: stores, error: storesError } = await supabaseAdmin
      .from('stores')
      .select('id, tenant_id, seller_id, marketplace')
      .eq('seller_id', sellerId)
      .is('deleted_at', null)
      .eq('is_active', true);

    if (storesError) {
      throw new Error(`Failed to resolve store ownership: ${storesError.message}`);
    }

    const matchingStores = (stores || []).filter((store: any) => {
      if (!marketplaceId) return true;
      const normalizedMarketplace = String(store.marketplace || '').trim().toUpperCase();
      return normalizedMarketplace === String(marketplaceId).trim().toUpperCase();
    });

    if (matchingStores.length !== 1) {
      return {
        sellerId,
        ambiguous: matchingStores.length > 1
      };
    }

    const matchedStore = matchingStores[0] as any;
    const { data: tokens, error: tokensError } = await supabaseAdmin
      .from('tokens')
      .select('user_id, tenant_id, store_id')
      .eq('provider', 'amazon')
      .eq('tenant_id', matchedStore.tenant_id)
      .eq('store_id', String(matchedStore.id))
      .order('updated_at', { ascending: false })
      .limit(5);

    if (tokensError) {
      throw new Error(`Failed to resolve Amazon token ownership: ${tokensError.message}`);
    }

    const uniqueUserIds = [...new Set((tokens || []).map((row: any) => String(row.user_id || '').trim()).filter(Boolean))] as string[];
    if (uniqueUserIds.length !== 1) {
      return {
        tenantId: matchedStore.tenant_id,
        storeId: matchedStore.id,
        sellerId,
        ambiguous: uniqueUserIds.length > 1,
        lineageResolution: 'seller.store_without_unique_user'
      };
    }

    const context: NotificationOwnershipContext = {
      tenantId: matchedStore.tenant_id,
      storeId: matchedStore.id,
      userId: uniqueUserIds[0],
      sellerId,
      lineageResolution: 'seller.store.token'
    };

    if (subscriptionId) {
      await this.upsertBinding({
        tenantId: context.tenantId!,
        storeId: context.storeId!,
        userId: context.userId!,
        sellerId,
        amazonSubscriptionId: subscriptionId,
        amazonDestinationId: destinationId || undefined,
        marketplaceId
      });
    }

    return context;
  }

  private async upsertBinding(binding: {
    tenantId: string;
    storeId: string;
    userId: string;
    sellerId: string;
    amazonSubscriptionId?: string;
    amazonDestinationId?: string;
    marketplaceId?: string;
  }): Promise<void> {
    const { error } = await supabaseAdmin
      .from('amazon_notification_bindings')
      .upsert({
        tenant_id: binding.tenantId,
        store_id: binding.storeId,
        user_id: binding.userId,
        seller_id: binding.sellerId,
        amazon_subscription_id: binding.amazonSubscriptionId || null,
        amazon_destination_id: binding.amazonDestinationId || null,
        marketplace_id: binding.marketplaceId || null,
        is_active: true,
        metadata: {
          auto_bound: true
        },
        updated_at: new Date().toISOString()
      }, {
        onConflict: binding.amazonSubscriptionId ? 'amazon_subscription_id' : 'tenant_id,store_id,seller_id'
      });

    if (error) {
      logger.warn('[AMAZON NOTIFICATIONS] Failed to upsert binding', {
        sellerId: binding.sellerId,
        storeId: binding.storeId,
        subscriptionId: binding.amazonSubscriptionId,
        error: error.message
      });
    }
  }
}

export const amazonNotificationOwnershipService = new AmazonNotificationOwnershipService();
export default amazonNotificationOwnershipService;
