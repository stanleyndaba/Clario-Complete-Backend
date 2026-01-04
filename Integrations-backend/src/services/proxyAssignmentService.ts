/**
 * Proxy Assignment Service
 * 
 * IP CONTAMINATION PREVENTION
 * 
 * This service manages the mapping between sellers and their dedicated proxy sessions.
 * Each seller MUST have a unique, consistent IP address when communicating with Amazon.
 * 
 * Why this matters:
 * - Using the same IP for multiple sellers causes Amazon to link the accounts
 * - If one account gets suspended, all linked accounts get "chain banned"
 * - Residential proxies with sticky sessions ensure each seller has a unique IP
 * 
 * Supported Providers:
 * - Bright Data (brightdata.com)
 * - Oxylabs (oxylabs.io)
 * - SmartProxy (smartproxy.com)
 */

import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';
import crypto from 'crypto';

export interface ProxyConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    sessionId: string;
    protocol: 'http' | 'https';
}

export interface ProxyAssignment {
    id: string;
    seller_id: string;
    proxy_session_id: string;
    proxy_provider: string;
    proxy_region: string;
    last_known_ip: string | null;
    status: string;
}

// Environment variables for proxy configuration
const PROXY_CONFIG = {
    // Bright Data defaults (most common for residential proxies)
    PROVIDER: process.env.PROXY_PROVIDER || 'brightdata',
    HOST: process.env.PROXY_HOST || 'brd.superproxy.io',
    PORT: parseInt(process.env.PROXY_PORT || '22225'),
    USERNAME: process.env.PROXY_USERNAME || '',
    PASSWORD: process.env.PROXY_PASSWORD || '',
    ZONE: process.env.PROXY_ZONE || 'residential',
    COUNTRY: process.env.PROXY_COUNTRY || 'us',

    // Feature flag to enable/disable proxy routing
    ENABLED: process.env.ENABLE_PROXY_ROUTING === 'true',
};

class ProxyAssignmentService {

    /**
     * Get or create a proxy assignment for a seller
     * Ensures each seller always uses the same proxy session
     */
    async getProxyForSeller(sellerId: string): Promise<ProxyConfig | null> {
        if (!PROXY_CONFIG.ENABLED) {
            logger.debug('[PROXY] Proxy routing disabled, using direct connection');
            return null;
        }

        if (!PROXY_CONFIG.USERNAME || !PROXY_CONFIG.PASSWORD) {
            logger.warn('[PROXY] Proxy credentials not configured, using direct connection');
            return null;
        }

        try {
            // Check for existing assignment
            let assignment = await this.getAssignment(sellerId);

            if (!assignment) {
                // Create new assignment for this seller
                assignment = await this.createAssignment(sellerId);
            }

            if (!assignment) {
                logger.error('[PROXY] Failed to get/create proxy assignment for seller', { sellerId });
                return null;
            }

            // Build proxy configuration based on provider
            return this.buildProxyConfig(assignment);

        } catch (error: any) {
            logger.error('[PROXY] Error getting proxy for seller', {
                sellerId,
                error: error.message
            });
            return null;
        }
    }

    /**
     * Get existing proxy assignment for a seller
     */
    private async getAssignment(sellerId: string): Promise<ProxyAssignment | null> {
        const { data, error } = await supabaseAdmin
            .from('seller_proxy_assignments')
            .select('*')
            .eq('seller_id', sellerId)
            .eq('status', 'active')
            .single();

        if (error && error.code !== 'PGRST116') {
            logger.warn('[PROXY] Error fetching proxy assignment', { sellerId, error: error.message });
        }

        return data as ProxyAssignment | null;
    }

    /**
     * Create a new proxy assignment for a seller
     * Generates a unique session ID for sticky proxy sessions
     */
    private async createAssignment(sellerId: string): Promise<ProxyAssignment | null> {
        // Generate deterministic session ID from seller ID
        // This ensures the same seller always gets the same session
        const sessionId = this.generateSessionId(sellerId);

        const { data, error } = await supabaseAdmin
            .from('seller_proxy_assignments')
            .insert({
                seller_id: sellerId,
                proxy_session_id: sessionId,
                proxy_provider: PROXY_CONFIG.PROVIDER,
                proxy_region: PROXY_CONFIG.COUNTRY,
                status: 'active'
            })
            .select()
            .single();

        if (error) {
            // Handle race condition - another process might have created it
            if (error.code === '23505') { // Unique constraint violation
                return this.getAssignment(sellerId);
            }
            logger.error('[PROXY] Error creating proxy assignment', { sellerId, error: error.message });
            return null;
        }

        logger.info('[PROXY] Created new proxy assignment for seller', {
            sellerId,
            sessionId,
            provider: PROXY_CONFIG.PROVIDER
        });

        return data as ProxyAssignment;
    }

    /**
     * Generate a deterministic session ID for a seller
     * Same seller always gets same session = same IP
     */
    private generateSessionId(sellerId: string): string {
        const hash = crypto
            .createHash('sha256')
            .update(`opside_seller_${sellerId}`)
            .digest('hex')
            .substring(0, 16);

        return `opside_${hash}`;
    }

    /**
     * Build proxy configuration for a specific provider
     */
    private buildProxyConfig(assignment: ProxyAssignment): ProxyConfig {
        const provider = assignment.proxy_provider || PROXY_CONFIG.PROVIDER;

        switch (provider) {
            case 'brightdata':
                return this.buildBrightDataConfig(assignment);
            case 'oxylabs':
                return this.buildOxylabsConfig(assignment);
            case 'smartproxy':
                return this.buildSmartProxyConfig(assignment);
            default:
                return this.buildBrightDataConfig(assignment);
        }
    }

    /**
     * Bright Data proxy configuration
     * Format: username-session-{session_id}:password@host:port
     */
    private buildBrightDataConfig(assignment: ProxyAssignment): ProxyConfig {
        // Bright Data session format: username-session-{id}-country-{country}
        const sessionUsername = `${PROXY_CONFIG.USERNAME}-session-${assignment.proxy_session_id}-country-${assignment.proxy_region}`;

        return {
            host: PROXY_CONFIG.HOST,
            port: PROXY_CONFIG.PORT,
            username: sessionUsername,
            password: PROXY_CONFIG.PASSWORD,
            sessionId: assignment.proxy_session_id,
            protocol: 'http'
        };
    }

    /**
     * Oxylabs proxy configuration
     */
    private buildOxylabsConfig(assignment: ProxyAssignment): ProxyConfig {
        // Oxylabs session format: customer-{username}-cc-{country}-sessid-{session_id}
        const sessionUsername = `customer-${PROXY_CONFIG.USERNAME}-cc-${assignment.proxy_region}-sessid-${assignment.proxy_session_id}`;

        return {
            host: process.env.OXYLABS_HOST || 'pr.oxylabs.io',
            port: parseInt(process.env.OXYLABS_PORT || '7777'),
            username: sessionUsername,
            password: PROXY_CONFIG.PASSWORD,
            sessionId: assignment.proxy_session_id,
            protocol: 'http'
        };
    }

    /**
     * SmartProxy configuration
     */
    private buildSmartProxyConfig(assignment: ProxyAssignment): ProxyConfig {
        // SmartProxy session format: user-{username}-session-{session_id}-country-{country}
        const sessionUsername = `user-${PROXY_CONFIG.USERNAME}-session-${assignment.proxy_session_id}-country-${assignment.proxy_region}`;

        return {
            host: process.env.SMARTPROXY_HOST || 'gate.smartproxy.com',
            port: parseInt(process.env.SMARTPROXY_PORT || '7000'),
            username: sessionUsername,
            password: PROXY_CONFIG.PASSWORD,
            sessionId: assignment.proxy_session_id,
            protocol: 'http'
        };
    }

    /**
     * Update the last known IP for a seller (for audit purposes)
     */
    async updateLastKnownIp(sellerId: string, ipAddress: string): Promise<void> {
        try {
            await supabaseAdmin
                .from('seller_proxy_assignments')
                .update({
                    last_known_ip: ipAddress,
                    last_ip_check: new Date().toISOString()
                })
                .eq('seller_id', sellerId);
        } catch (error: any) {
            logger.warn('[PROXY] Failed to update last known IP', {
                sellerId,
                error: error.message
            });
        }
    }

    /**
     * Rotate proxy session for a seller (if IP is compromised)
     */
    async rotateProxySession(sellerId: string): Promise<ProxyAssignment | null> {
        try {
            // Mark current assignment as rotated
            await supabaseAdmin
                .from('seller_proxy_assignments')
                .update({ status: 'rotated' })
                .eq('seller_id', sellerId)
                .eq('status', 'active');

            // Create new assignment with new session ID
            const newSessionId = this.generateSessionId(`${sellerId}_${Date.now()}`);

            const { data, error } = await supabaseAdmin
                .from('seller_proxy_assignments')
                .insert({
                    seller_id: sellerId,
                    proxy_session_id: newSessionId,
                    proxy_provider: PROXY_CONFIG.PROVIDER,
                    proxy_region: PROXY_CONFIG.COUNTRY,
                    status: 'active'
                })
                .select()
                .single();

            if (error) {
                logger.error('[PROXY] Failed to rotate proxy session', { sellerId, error: error.message });
                return null;
            }

            logger.info('[PROXY] Rotated proxy session for seller', {
                sellerId,
                newSessionId
            });

            return data as ProxyAssignment;

        } catch (error: any) {
            logger.error('[PROXY] Error rotating proxy session', {
                sellerId,
                error: error.message
            });
            return null;
        }
    }

    /**
     * Check if proxy routing is enabled
     */
    isEnabled(): boolean {
        return PROXY_CONFIG.ENABLED;
    }

    /**
     * Get proxy configuration summary (for debugging)
     */
    getConfigSummary(): object {
        return {
            enabled: PROXY_CONFIG.ENABLED,
            provider: PROXY_CONFIG.PROVIDER,
            host: PROXY_CONFIG.HOST,
            port: PROXY_CONFIG.PORT,
            zone: PROXY_CONFIG.ZONE,
            country: PROXY_CONFIG.COUNTRY,
            credentialsConfigured: !!(PROXY_CONFIG.USERNAME && PROXY_CONFIG.PASSWORD)
        };
    }
}

export const proxyAssignmentService = new ProxyAssignmentService();
export default proxyAssignmentService;
