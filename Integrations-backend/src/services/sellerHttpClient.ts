/**
 * Seller HTTP Client
 * 
 * IP CONTAMINATION PREVENTION
 * 
 * This HTTP client automatically routes requests through the correct proxy
 * based on the seller making the request. Each seller has a dedicated proxy
 * session that ensures they always appear from the same IP address.
 * 
 * Usage:
 *   const client = new SellerHttpClient(sellerId);
 *   const response = await client.get('https://api.amazon.com/...');
 * 
 * The client will:
 * 1. Look up the seller's proxy assignment
 * 2. Configure the HTTP agent with the correct proxy
 * 3. Make the request through that proxy
 * 4. Log the IP used for audit purposes
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { proxyAssignmentService, ProxyConfig } from './proxyAssignmentService';
import logger from '../utils/logger';

export interface SellerHttpClientOptions {
    timeout?: number;
    headers?: Record<string, string>;
}

export class SellerHttpClient {
    private sellerId: string;
    private axiosInstance: AxiosInstance | null = null;
    private proxyConfig: ProxyConfig | null = null;
    private initialized: boolean = false;

    constructor(sellerId: string, options: SellerHttpClientOptions = {}) {
        this.sellerId = sellerId;

        // Create base axios instance (will be configured with proxy on first request)
        this.axiosInstance = axios.create({
            timeout: options.timeout || 30000,
            headers: options.headers || {}
        });
    }

    /**
     * Initialize the client with the seller's proxy configuration
     */
    private async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Get proxy configuration for this seller
            this.proxyConfig = await proxyAssignmentService.getProxyForSeller(this.sellerId);

            if (this.proxyConfig) {
                // Create proxy agent
                const proxyUrl = `${this.proxyConfig.protocol}://${this.proxyConfig.username}:${this.proxyConfig.password}@${this.proxyConfig.host}:${this.proxyConfig.port}`;
                const agent = new HttpsProxyAgent(proxyUrl);

                // Configure axios to use proxy
                this.axiosInstance = axios.create({
                    timeout: 30000,
                    httpsAgent: agent,
                    httpAgent: agent,
                    proxy: false // Disable axios's built-in proxy to use agent instead
                });

                logger.debug('[HTTP CLIENT] Initialized with proxy for seller', {
                    sellerId: this.sellerId,
                    sessionId: this.proxyConfig.sessionId,
                    host: this.proxyConfig.host
                });
            } else {
                // FAIL-CLOSED: Never proceed without a proxy
                throw new Error(
                    `[FAIL-CLOSED] No proxy configured for seller ${this.sellerId}. ` +
                    `Refusing to use direct connection to prevent IP contamination.`
                );
            }

            this.initialized = true;

        } catch (error: any) {
            // FAIL-CLOSED: Do NOT fall back to direct connection
            logger.error('[HTTP CLIENT] FAIL-CLOSED: Proxy initialization failed, BLOCKING request', {
                sellerId: this.sellerId,
                error: error.message
            });
            this.initialized = false;
            throw new Error(
                `[FAIL-CLOSED] Proxy failed for seller ${this.sellerId}: ${error.message}. ` +
                `Request blocked to prevent IP contamination.`
            );
        }
    }

    /**
     * Make a GET request through the seller's proxy
     */
    async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        await this.initialize();

        if (!this.axiosInstance) {
            throw new Error('HTTP client not initialized');
        }

        const response = await this.axiosInstance.get<T>(url, config);
        await this.logRequestIp(response);
        return response;
    }

    /**
     * Make a POST request through the seller's proxy
     */
    async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        await this.initialize();

        if (!this.axiosInstance) {
            throw new Error('HTTP client not initialized');
        }

        const response = await this.axiosInstance.post<T>(url, data, config);
        await this.logRequestIp(response);
        return response;
    }

    /**
     * Make a PUT request through the seller's proxy
     */
    async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        await this.initialize();

        if (!this.axiosInstance) {
            throw new Error('HTTP client not initialized');
        }

        const response = await this.axiosInstance.put<T>(url, data, config);
        await this.logRequestIp(response);
        return response;
    }

    /**
     * Make a DELETE request through the seller's proxy
     */
    async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        await this.initialize();

        if (!this.axiosInstance) {
            throw new Error('HTTP client not initialized');
        }

        const response = await this.axiosInstance.delete<T>(url, config);
        await this.logRequestIp(response);
        return response;
    }

    /**
     * Make a generic request through the seller's proxy
     */
    async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
        await this.initialize();

        if (!this.axiosInstance) {
            throw new Error('HTTP client not initialized');
        }

        const response = await this.axiosInstance.request<T>(config);
        await this.logRequestIp(response);
        return response;
    }

    /**
     * Log the IP address used for this request (for audit purposes)
     */
    private async logRequestIp(response: AxiosResponse): Promise<void> {
        try {
            // Some proxy providers return the public IP in response headers
            const proxyIp = response.headers['x-proxy-ip'] ||
                response.headers['x-real-ip'] ||
                response.headers['x-forwarded-for'];

            if (proxyIp && this.proxyConfig) {
                await proxyAssignmentService.updateLastKnownIp(this.sellerId, String(proxyIp));
            }
        } catch (error) {
            // Non-critical, just for logging
        }
    }

    /**
     * Get the current proxy configuration (for debugging)
     */
    getProxyInfo(): { sessionId: string | null; host: string | null } {
        return {
            sessionId: this.proxyConfig?.sessionId || null,
            host: this.proxyConfig?.host || null
        };
    }

    /**
     * Check if this client is using a proxy
     */
    isUsingProxy(): boolean {
        return this.proxyConfig !== null;
    }
}

/**
 * Factory function to create a seller-specific HTTP client
 */
export function createSellerHttpClient(sellerId: string, options?: SellerHttpClientOptions): SellerHttpClient {
    return new SellerHttpClient(sellerId, options);
}

export default SellerHttpClient;
