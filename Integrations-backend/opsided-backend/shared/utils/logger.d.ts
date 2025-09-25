import winston from 'winston';
declare const logger: winston.Logger;
export declare const getLogger: (module: string) => {
    error: (message: string, meta?: any) => void;
    warn: (message: string, meta?: any) => void;
    info: (message: string, meta?: any) => void;
    http: (message: string, meta?: any) => void;
    debug: (message: string, meta?: any) => void;
    verbose: (message: string, meta?: any) => void;
    silly: (message: string, meta?: any) => void;
};
export declare const createHttpLogger: () => winston.Logger;
export declare const getAmazonLogger: () => winston.Logger;
export declare const getGmailLogger: () => winston.Logger;
export declare const getStripeLogger: () => winston.Logger;
export declare const logRequest: (req: any, res: any, responseTime: number) => void;
export declare const logDatabaseQuery: (query: string, params: any[], duration: number) => void;
export declare const logExternalApiCall: (service: string, endpoint: string, method: string, statusCode: number, duration: number, error?: any) => void;
export declare const logSyncOperation: (provider: string, operation: string, status: string, details: any) => void;
export declare const setupLogRotation: () => void;
export default logger;
//# sourceMappingURL=logger.d.ts.map