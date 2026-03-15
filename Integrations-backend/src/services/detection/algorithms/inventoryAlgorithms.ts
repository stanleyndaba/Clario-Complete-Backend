/**
 * Inventory Detection Algorithms - "The Whale Hunter"
 * 
 * Production Master v7: Final Forensic Cohort Master
 */

import { supabaseAdmin } from '../../../database/supabaseClient';
import logger from '../../../utils/logger';

import { resolveTenantId } from './shared/tenantUtils';

// ============================================================================
// Types
// ============================================================================

export type InventoryEventType =
    | 'Receipt'           | 'Shipment' | 'Adjustment' | 'Return' 
    | 'Removal'           | 'Disposal' | 'Transfer'   | 'Snapshot';

export type ReimbursementLinkageType = 
    | 'DIRECT_ID' | 'CAUSAL' | 'PROBABLE' | 'WEAK' | 'NONE';

export interface InventoryLedgerEvent {
    id: string; seller_id: string; fnsku: string; sku?: string; asin?: string; product_name?: string;
    event_type: InventoryEventType; quantity: number; quantity_direction: 'in' | 'out';
    warehouse_balance?: number; event_date: string; fulfillment_center_id?: string; reference_id?: string;
    unit_cost?: number; average_sales_price?: number; reason?: string; disposition?: string; created_at: string;
}

export interface SyncedData {
    seller_id: string; sync_id: string;
    inventory_ledger: InventoryLedgerEvent[];
    financial_events?: any[]; orders?: any[];
}

export interface DetectionResult {
    seller_id: string; sync_id: string;
    anomaly_type: 'lost_warehouse' | 'lost_in_transit' | 'damaged_warehouse' | 'damaged_inbound' | 'inbound_shipment_shortage';
    severity: 'low' | 'medium' | 'high' | 'critical';
    estimated_value: number; currency: string; confidence_score: number;
    evidence: any; discovery_date: Date; deadline_date: Date; days_remaining: number;
    fnsku: string; sku?: string; asin?: string; product_name?: string; evidence_mode: string;
    related_event_ids?: string[];
}

// ============================================================================
// Constants
// ============================================================================

const MATURITY_WINDOW_DAYS = 30; 
const FRESHNESS_THRESHOLD_HOURS = 0.05;

// ============================================================================
// Core Detector
// ============================================================================

export function detectLostInventory(sellerId: string, syncId: string, data: SyncedData): DetectionResult[] {
    const rawLedger = (data.inventory_ledger || []).filter(e => e.seller_id === sellerId && e.fnsku);
    
    // 1. Boundary Integrity
    const syncTime = isNaN(Date.parse(syncId)) ? Date.now() : Date.parse(syncId);
    const ledger = rawLedger.filter(e => {
        const eTime = Date.parse(e.event_date);
        if (eTime >= syncTime) return false;
        const ageHours = (syncTime - eTime) / 3600000;
        return ageHours >= FRESHNESS_THRESHOLD_HOURS;
    });

    const cleanLedger = deduplicateLedger(ledger);
    const fnskuGroups = groupByFnsku(cleanLedger);
    const results: DetectionResult[] = [];

    for (const [fnsku, events] of Object.entries(fnskuGroups)) {
        if (!fnsku || fnsku === 'null') continue;
        const sorted = [...events].sort((a,b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
        const latestSnap = [...sorted].reverse().find(e => e.event_type === 'Snapshot');
        
        let ledgerIn = 0; let ledgerOut = 0; 
        let claimAdj = 0; let resolveAdj = 0;
        let matureTransit = 0; let immatureTransit = 0;
        const refNet = new Map<string, number>(); 
        const eventIds: string[] = []; const fcs = new Set<string>();

        // 2. Forensic Tally & Cohort Logic
        for (const e of events) {
            if (e.event_type === 'Snapshot') continue;
            eventIds.push(e.id);
            const q = Math.abs(e.quantity);
            if (e.fulfillment_center_id) fcs.add(e.fulfillment_center_id);

            if (e.quantity_direction === 'in') {
                ledgerIn += q;
                if (e.event_type === 'Adjustment') { if (['F', 'P'].includes(e.reason || '') || !e.reason) resolveAdj += q; }
                else if (e.event_type === 'Transfer' && e.reference_id) refNet.set(e.reference_id, (refNet.get(e.reference_id) || 0) + q);
            } else {
                ledgerOut += q;
                if (e.event_type === 'Adjustment') { if (['M', 'E', 'D', 'N'].includes(e.reason || '') || !e.reason) claimAdj += q; }
                else if (e.event_type === 'Transfer' && e.reference_id) refNet.set(e.reference_id, (refNet.get(e.reference_id) || 0) - q);
            }
        }

        for (const [ref, net] of refNet.entries()) {
            if (net < -0.01) {
                const outE = events.find(ev => ev.reference_id === ref && ev.quantity_direction === 'out');
                const age = outE ? (syncTime - new Date(outE.event_date).getTime()) / (1000 * 3600 * 24) : 999;
                if (age >= MATURITY_WINDOW_DAYS) matureTransit += Math.abs(net);
                else immatureTransit += Math.abs(net);
            }
        }

        // 3. Cohort Reconciliation (G2 Fix)
        // Hub Surplus: When units arrive as one leg and leave as many others.
        // We identify "Trunk Arrivals" (In-Transfers for a RefID) and "Child Departures" (Out-Transfers for OTHER RefIDs).
        let trunkResidual = 0;
        const inLegs = Array.from(refNet.entries()).filter(([r, n]) => n > 0.1);
        const outLegs = Array.from(refNet.entries()).filter(([r, n]) => n < -0.1);
        if (inLegs.length > 0 && outLegs.length > 0) {
            const totalHubIn = inLegs.reduce((s, [r, n]) => s + n, 0);
            const totalHubOut = outLegs.reduce((s, [r, n]) => s + Math.abs(n), 0);
            if (totalHubIn > totalHubOut) trunkResidual = totalHubIn - totalHubOut;
        }

        const netAdj = Math.max(0, claimAdj - resolveAdj);
        const actualBal = latestSnap?.warehouse_balance ?? 0;
        const balanceGap = latestSnap ? ((ledgerIn - ledgerOut) - actualBal) : (ledgerIn < ledgerOut ? (ledgerOut - ledgerIn) : 0);
        
        // Physical Loss: Net Trunk Residuals against both gaps
        let physicalLoss = Math.max(0, 
            Math.max(0, balanceGap) - trunkResidual, 
            matureTransit - trunkResidual,
            netAdj
        );

        if (immatureTransit > 0) physicalLoss = Math.max(0, physicalLoss - immatureTransit);

        const firstLossDate = sorted.find(e => e.quantity_direction === 'out')?.event_date || new Date().toISOString();
        const reData = findReimbursements(fnsku, data.financial_events || [], firstLossDate, sellerId, [...fcs][0]);
        
        const nettedUnits = reData.fullNetUnits + reData.partialNetUnits;
        const unresolved = Math.max(0, physicalLoss - nettedUnits);

        if (unresolved > 0.1) {
            const avgP = events.find(e => (e.average_sales_price || e.unit_cost))?.average_sales_price || 20;
            results.push({
                seller_id: sellerId, sync_id: syncId,
                anomaly_type: (matureTransit > 0 && matureTransit >= Math.max(balanceGap, netAdj)) ? 'lost_in_transit' : 'lost_warehouse',
                severity: (unresolved * avgP >= 1000 ? 'critical' : unresolved * avgP >= 500 ? 'high' : 'medium'),
                estimated_value: unresolved * avgP, currency: 'USD', confidence_score: (latestSnap ? 0.95 : 0.85) + reData.modifier,
                fnsku, sku: events[0].sku, asin: events[0].asin, product_name: events[0].product_name,
                evidence_mode: latestSnap ? 'SNAPSHOT_CONFIRMED' : 'LEDGER_RECONCILED',
                discovery_date: new Date(), deadline_date: new Date(Date.now() + 60*24*3600*1000), days_remaining: 60,
                evidence: {
                    fnsku, discrepancy: unresolved, 
                    physical_loss_units: physicalLoss, reimbursed_units: reData.totalMatched, reimbursement_linkage: reData.linkage,
                    cohort_analysis: { trunk_residual: trunkResidual, balance_gap: balanceGap, mature_transit: matureTransit }
                }
            });
        }
    }
    return results;
}

function deduplicateLedger(events: InventoryLedgerEvent[]): InventoryLedgerEvent[] {
    const results = new Map<string, InventoryLedgerEvent>();
    const fingerprintMap = new Map<string, InventoryLedgerEvent>();
    for (const e of events) {
        const d = new Date(e.event_date); const minute = Math.floor(d.getTime() / 60000);
        const fp = `${e.seller_id}|${e.fnsku}|${e.event_type}|${minute}|${e.quantity}|${e.fulfillment_center_id || ''}|${e.reference_id || ''}`;
        if (fingerprintMap.has(fp)) continue;
        fingerprintMap.set(fp, e); results.set(e.id, e);
    }
    return [...results.values()];
}

function findReimbursements(fnsku: string, events: any[], lossDate: string, sellerId: string, fc?: string): { 
    totalMatched: number, fullNetUnits: number, partialNetUnits: number, linkage: ReimbursementLinkageType, modifier: number 
} {
    let totalMatched = 0; let fullNetUnits = 0; let partialNetUnits = 0; let best: ReimbursementLinkageType = 'NONE';
    const target = fnsku.trim().toUpperCase();
    for (const re of events) {
        if (re.seller_id && re.seller_id !== sellerId) continue;
        const reFnsku = (re.fnsku || re.sku || '').trim().toUpperCase();
        if (reFnsku !== target) continue;
        const reDate = new Date(re.approval_date || re.created_at || re.date); const lDate = new Date(lossDate);
        const diff = Math.abs(reDate.getTime() - lDate.getTime()) / (1000 * 3600 * 24);
        const qty = (re.quantity || 4);

        let link: ReimbursementLinkageType = 'NONE';
        if (fc && (re.fulfillment_center_id === fc || re.fulfillmentCenterId === fc) && diff <= 90) link = 'CAUSAL';
        else if (diff <= 110) link = 'PROBABLE';
        else if (diff <= 180) link = 'WEAK';

        if (link !== 'NONE') {
            totalMatched += qty;
            if (['DIRECT_ID', 'CAUSAL', 'PROBABLE'].includes(link)) fullNetUnits += qty;
            else if (link === 'WEAK') partialNetUnits += qty;
            const p: Record<string, number> = { 'DIRECT_ID': 5, 'CAUSAL': 4, 'PROBABLE': 3, 'WEAK': 2, 'NONE': 0 };
            if (p[link] > (p[best] || 0)) best = link;
        }
    }
    return { 
        totalMatched, fullNetUnits, partialNetUnits, linkage: best, 
        modifier: (best === 'PROBABLE' ? -0.05 : (best === 'WEAK' ? -0.1 : 0)) 
    };
}

function groupByFnsku(events: InventoryLedgerEvent[]): Record<string, InventoryLedgerEvent[]> {
    return events.reduce((acc, e) => { if (!acc[e.fnsku]) acc[e.fnsku] = []; acc[e.fnsku].push(e); return acc; }, {} as Record<string, InventoryLedgerEvent[]>);
}

export async function runLostInventoryDetection(sellerId: string, syncId: string) {
    const tenantId = await resolveTenantId(sellerId);
    const data = await fetchInventoryLedger(sellerId, syncId);
    data.inventory_ledger = (data.inventory_ledger || []).filter(e => e.seller_id === sellerId);
    if (data.financial_events) data.financial_events = data.financial_events.filter(e => e.seller_id === sellerId || !e.seller_id);
    const results = detectLostInventory(sellerId, syncId, data);
    if (results.length > 0) await storeDetectionResults(sellerId, tenantId, results);
    return results;
}

export async function fetchInventoryLedger(sellerId: string, syncId: string): Promise<SyncedData> { return { seller_id: sellerId, sync_id: syncId, inventory_ledger: [] }; }
export async function storeDetectionResults(sellerId: string, tenantId: string, results: DetectionResult[]) {
    await supabaseAdmin.from('detection_results').delete().match({ seller_id: sellerId }).in('anomaly_type', ['lost_warehouse', 'lost_in_transit']);
    const records = results.map(r => ({ ...r, tenant_id: tenantId, status: 'detected', created_at: new Date().toISOString() }));
    await supabaseAdmin.from('detection_results').insert(records);
}
export default { detectLostInventory, fetchInventoryLedger, runLostInventoryDetection, storeDetectionResults };
