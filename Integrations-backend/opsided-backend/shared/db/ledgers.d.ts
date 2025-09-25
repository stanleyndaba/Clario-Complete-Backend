interface ReportData {
    id: string;
    type: string;
    amount?: number;
    currency?: string;
    date: string;
    sku?: string;
    orderId?: string;
    description?: string;
    source: string;
    externalId?: string;
    metadata: {
        [key: string]: any;
    };
}
interface StoreOptions {
    startDate: string;
    endDate: string;
    source: string;
    syncType: 'historical' | 'real-time';
}
interface SyncStatus {
    userId: string;
    reportType: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    recordsProcessed: number;
    totalRecords: number;
    startDate: string;
    endDate: string;
    lastUpdated: string;
    errorMessage?: string;
}
declare class Ledgers {
    storeReportData(userId: string, reportType: string, data: ReportData[], options: StoreOptions): Promise<void>;
    private insertReportData;
    private updateSyncStatus;
    getSyncStatus(userId: string, reportType?: string): Promise<SyncStatus[]>;
    createSyncStatus(userId: string, reportType: string, startDate: string, endDate: string): Promise<void>;
    getReportData(userId: string, reportType?: string, startDate?: string, endDate?: string, limit?: number, offset?: number): Promise<ReportData[]>;
    getReportSummary(userId: string, startDate?: string, endDate?: string): Promise<any>;
    deleteReportData(userId: string, reportType: string, startDate: string, endDate: string): Promise<number>;
    getDuplicateRecords(userId: string, reportType: string): Promise<ReportData[]>;
    removeDuplicates(userId: string, reportType: string): Promise<number>;
    saveCaseFile(userId: string, claimId: string, data: {
        mcdeDocId?: string;
        caseStatus?: string;
        syncedAt?: string;
        rawData?: any;
        normalizedData?: any;
        auditLog?: any;
    }): Promise<void>;
    updateCaseFileStatus(userId: string, claimId: string, status: string, auditLog?: any): Promise<void>;
    getCaseFilesForUser(userId: string): Promise<any[]>;
    initializeTables(): Promise<void>;
}
export declare const ledgers: Ledgers;
export default ledgers;
//# sourceMappingURL=ledgers.d.ts.map