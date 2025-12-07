/**
 * Schema Monitoring Service
 * Layer 1: SP-API Schema Monitoring
 * Detects Amazon API changes and auto-registers new claim types
 */

import { supabase, supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import crypto from 'crypto';

export interface SchemaChange {
    id: string;
    api_name: string;
    endpoint: string;
    change_type: 'new_field' | 'deprecated_field' | 'new_endpoint' | 'deprecated_endpoint' | 'new_claim_type' | 'schema_change';
    field_name: string | null;
    old_schema: Record<string, any> | null;
    new_schema: Record<string, any> | null;
    description: string | null;
    severity: 'info' | 'warning' | 'critical';
    acknowledged: boolean;
    detected_at: string;
}

export interface SchemaSnapshot {
    api_name: string;
    version: string | null;
    schema_hash: string;
    full_schema: Record<string, any>;
}

// Known SP-API schemas (simplified for monitoring)
const KNOWN_API_SCHEMAS = {
    'fba-inventory': {
        endpoints: ['/fba/inventory/v1/summaries'],
        claim_types: ['lost_inventory', 'damaged_inventory', 'inventory_discrepancy']
    },
    'fba-inbound': {
        endpoints: ['/fba/inbound/v0/shipments', '/fba/inbound/v0/shipmentItems'],
        claim_types: ['missing_from_inbound', 'carrier_damaged']
    },
    'orders': {
        endpoints: ['/orders/v0/orders'],
        claim_types: ['customer_return', 'order_discrepancy']
    },
    'finances': {
        endpoints: ['/finances/v0/financialEventGroups'],
        claim_types: ['overcharge', 'fee_discrepancy', 'reimbursement']
    }
};

class SchemaMonitoringService {
    /**
     * Check for schema changes across all known APIs
     * Should be called daily by a worker
     */
    async checkAllSchemas(): Promise<SchemaChange[]> {
        const changes: SchemaChange[] = [];

        for (const [apiName, config] of Object.entries(KNOWN_API_SCHEMAS)) {
            try {
                const apiChanges = await this.checkApiSchema(apiName, config);
                changes.push(...apiChanges);
            } catch (error: any) {
                logger.error(`Error checking schema for ${apiName}`, { error: error.message });
            }
        }

        if (changes.length > 0) {
            logger.info('🔍 [SCHEMA MONITORING] Detected changes', { count: changes.length });
        }

        return changes;
    }

    /**
     * Check schema for a specific API
     */
    private async checkApiSchema(
        apiName: string,
        config: { endpoints: string[]; claim_types: string[] }
    ): Promise<SchemaChange[]> {
        const changes: SchemaChange[] = [];
        const client = supabaseAdmin || supabase;

        // Get latest stored snapshot
        const { data: snapshot } = await client
            .from('schema_snapshots')
            .select('*')
            .eq('api_name', apiName)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // Generate current schema (in production, this would fetch from SP-API)
        const currentSchema = this.generateSchemaFromConfig(config);
        const currentHash = this.hashSchema(currentSchema);

        if (snapshot && snapshot.schema_hash === currentHash) {
            // No changes
            return [];
        }

        // Detect changes
        if (snapshot) {
            changes.push(...await this.detectChanges(apiName, snapshot.full_schema, currentSchema));
        } else {
            // First time seeing this API
            changes.push({
                id: crypto.randomUUID(),
                api_name: apiName,
                endpoint: config.endpoints[0] || '',
                change_type: 'new_endpoint',
                field_name: null,
                old_schema: null,
                new_schema: currentSchema,
                description: `First schema snapshot for ${apiName}`,
                severity: 'info',
                acknowledged: false,
                detected_at: new Date().toISOString()
            });
        }

        // Store new snapshot
        await this.storeSnapshot(apiName, currentSchema, currentHash);

        // Store changes
        for (const change of changes) {
            await this.storeChange(change);
        }

        return changes;
    }

    /**
     * Detect specific changes between schemas
     */
    private async detectChanges(
        apiName: string,
        oldSchema: Record<string, any>,
        newSchema: Record<string, any>
    ): Promise<SchemaChange[]> {
        const changes: SchemaChange[] = [];

        // Check for new fields
        const oldFields = new Set<string>(oldSchema.fields || []);
        const newFields = new Set<string>(newSchema.fields || []);

        for (const field of newFields) {
            if (!oldFields.has(field)) {
                changes.push({
                    id: crypto.randomUUID(),
                    api_name: apiName,
                    endpoint: newSchema.endpoints?.[0] || '',
                    change_type: 'new_field',
                    field_name: field,
                    old_schema: null,
                    new_schema: { field },
                    description: `New field detected: ${field}`,
                    severity: 'info',
                    acknowledged: false,
                    detected_at: new Date().toISOString()
                });
            }
        }

        // Check for deprecated fields
        for (const field of oldFields) {
            if (!newFields.has(field)) {
                changes.push({
                    id: crypto.randomUUID(),
                    api_name: apiName,
                    endpoint: oldSchema.endpoints?.[0] || '',
                    change_type: 'deprecated_field',
                    field_name: field,
                    old_schema: { field },
                    new_schema: null,
                    description: `Field deprecated: ${field}`,
                    severity: 'warning',
                    acknowledged: false,
                    detected_at: new Date().toISOString()
                });
            }
        }

        // Check for new claim types
        const oldClaimTypes = new Set<string>(oldSchema.claim_types || []);
        const newClaimTypes = new Set<string>(newSchema.claim_types || []);

        for (const claimType of newClaimTypes) {
            if (!oldClaimTypes.has(claimType)) {
                changes.push({
                    id: crypto.randomUUID(),
                    api_name: apiName,
                    endpoint: '',
                    change_type: 'new_claim_type',
                    field_name: claimType,
                    old_schema: null,
                    new_schema: { claim_type: claimType },
                    description: `New claim type detected: ${claimType}`,
                    severity: 'info',
                    acknowledged: false,
                    detected_at: new Date().toISOString()
                });

                // Auto-register new claim type
                await this.autoRegisterClaimType(claimType);
            }
        }

        return changes;
    }

    /**
     * Auto-register a new claim type
     */
    private async autoRegisterClaimType(claimType: string): Promise<void> {
        try {
            const client = supabaseAdmin || supabase;

            // Check if already exists
            const { data: existing } = await client
                .from('claim_rules')
                .select('id')
                .eq('claim_type', claimType)
                .eq('rule_type', 'detection')
                .maybeSingle();

            if (existing) return;

            // Create default detection rule
            await client.from('claim_rules').insert({
                rule_name: `${claimType}_auto_detection`,
                claim_type: claimType,
                rule_type: 'detection',
                conditions: {},
                actions: { create_claim: true, priority: 'normal', auto_file: false },
                priority: 50,
                is_active: true,
                created_by: 'schema_monitor'
            });

            // Create default evidence mapping
            await client.from('evidence_mappings').insert({
                claim_type: claimType,
                evidence_type: 'invoice',
                requirement_level: 'mandatory',
                weight: 1.00,
                description: `Auto-generated evidence requirement for ${claimType}`
            });

            logger.info('🆕 [SCHEMA MONITORING] Auto-registered new claim type', { claimType });
        } catch (error: any) {
            logger.error('Error auto-registering claim type', { error: error.message, claimType });
        }
    }

    /**
     * Store schema snapshot
     */
    private async storeSnapshot(
        apiName: string,
        schema: Record<string, any>,
        hash: string
    ): Promise<void> {
        try {
            const client = supabaseAdmin || supabase;

            await client.from('schema_snapshots').upsert({
                api_name: apiName,
                schema_hash: hash,
                full_schema: schema,
                created_at: new Date().toISOString()
            }, { onConflict: 'api_name,schema_hash' });
        } catch (error: any) {
            logger.error('Error storing schema snapshot', { error: error.message });
        }
    }

    /**
     * Store detected change
     */
    private async storeChange(change: SchemaChange): Promise<void> {
        try {
            const client = supabaseAdmin || supabase;

            await client.from('schema_changes').insert({
                api_name: change.api_name,
                endpoint: change.endpoint,
                change_type: change.change_type,
                field_name: change.field_name,
                old_schema: change.old_schema,
                new_schema: change.new_schema,
                description: change.description,
                severity: change.severity,
                acknowledged: false,
                detected_at: new Date().toISOString()
            });
        } catch (error: any) {
            logger.error('Error storing schema change', { error: error.message });
        }
    }

    /**
     * Get unacknowledged changes
     */
    async getUnacknowledgedChanges(): Promise<SchemaChange[]> {
        try {
            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('schema_changes')
                .select('*')
                .eq('acknowledged', false)
                .order('detected_at', { ascending: false });

            if (error) {
                logger.error('Error fetching unacknowledged changes', { error: error.message });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error in getUnacknowledgedChanges', { error: error.message });
            return [];
        }
    }

    /**
     * Acknowledge a change
     */
    async acknowledgeChange(changeId: string, acknowledgedBy: string): Promise<boolean> {
        try {
            const client = supabaseAdmin || supabase;

            const { error } = await client
                .from('schema_changes')
                .update({
                    acknowledged: true,
                    acknowledged_by: acknowledgedBy,
                    acknowledged_at: new Date().toISOString()
                })
                .eq('id', changeId);

            if (error) {
                logger.error('Error acknowledging change', { error: error.message, changeId });
                return false;
            }

            return true;
        } catch (error: any) {
            logger.error('Error in acknowledgeChange', { error: error.message, changeId });
            return false;
        }
    }

    /**
     * Get critical/warning changes that need attention
     */
    async getCriticalChanges(): Promise<SchemaChange[]> {
        try {
            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('schema_changes')
                .select('*')
                .eq('acknowledged', false)
                .in('severity', ['warning', 'critical'])
                .order('detected_at', { ascending: false });

            if (error) {
                logger.error('Error fetching critical changes', { error: error.message });
                return [];
            }

            return data || [];
        } catch (error: any) {
            logger.error('Error in getCriticalChanges', { error: error.message });
            return [];
        }
    }

    /**
     * Generate schema from config (in production, would fetch from SP-API)
     */
    private generateSchemaFromConfig(config: { endpoints: string[]; claim_types: string[] }): Record<string, any> {
        return {
            endpoints: config.endpoints,
            claim_types: config.claim_types,
            fields: this.getKnownFields(config.endpoints[0]),
            last_checked: new Date().toISOString()
        };
    }

    /**
     * Get known fields for an endpoint (simplified)
     */
    private getKnownFields(endpoint: string): string[] {
        const fieldsByEndpoint: Record<string, string[]> = {
            '/fba/inventory/v1/summaries': ['asin', 'fnsku', 'sellerSku', 'productName', 'condition', 'inventoryDetails'],
            '/fba/inbound/v0/shipments': ['shipmentId', 'shipmentName', 'shipmentStatus', 'labelPrepType', 'destinationFulfillmentCenterId'],
            '/orders/v0/orders': ['AmazonOrderId', 'PurchaseDate', 'OrderStatus', 'FulfillmentChannel', 'OrderTotal'],
            '/finances/v0/financialEventGroups': ['FinancialEventGroupId', 'ProcessingStatus', 'FundTransferStatus', 'OriginalTotal']
        };

        return fieldsByEndpoint[endpoint] || [];
    }

    /**
     * Hash a schema for comparison
     */
    private hashSchema(schema: Record<string, any>): string {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(schema, Object.keys(schema).sort()))
            .digest('hex')
            .substring(0, 16);
    }
}

export const schemaMonitoringService = new SchemaMonitoringService();
export default schemaMonitoringService;
