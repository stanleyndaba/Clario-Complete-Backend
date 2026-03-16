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
    const syncTime = isNaN(Date.parse(syncId)) ? Date.now() : Date.parse(syncId);
    
    // 1. Boundary Integrity (Strict half-open [start, syncTime))
    const ledger = rawLedger.filter(e => {
        const eTime = Date.parse(e.event_date);
        if (eTime >= syncTime) return false;
        const ageHours = (syncTime - eTime) / 3600000;
        return ageHours >= FRESHNESS_THRESHOLD_HOURS;
    });

    const cleanLedger = deduplicateLedger(ledger);
    const fnskuGroups = groupByFnsku(cleanLedger);
    const results: DetectionResult[] = [];

    for (const [fnsku, allEvents] of Object.entries(fnskuGroups)) {
        if (!fnsku || fnsku === 'null') continue;
        const sorted = [...allEvents].sort((a,b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
        const latestSnap = [...sorted].reverse().find(e => e.event_type === 'Snapshot');
        
        // --- Quantitative Cohort Accounting ---
        const transfersOut = sorted.filter(e => e.event_type === 'Transfer' && e.quantity_direction === 'out');
        const transfersIn = sorted.filter(e => e.event_type === 'Transfer' && e.quantity_direction === 'in');
        
        // Track consumed units to enforce one-consumption-only rule
        const consumedInMap = new Map<string, number>(); // eventId -> quantityConsumed
        const matchedOutMetrics = new Map<string, { matched: number, mode: string, score: number }>(); // eventId -> metrics

        // Step A: Primary Match (Exact Reference ID)
        for (const outE of transfersOut) {
            if (!outE.reference_id) continue;
            const matches = transfersIn.filter(inE => inE.reference_id === outE.reference_id);
            let totalMatched = 0;
            for (const m of matches) {
                const available = Math.abs(m.quantity) - (consumedInMap.get(m.id) || 0);
                if (available <= 0) continue;
                const needed = Math.abs(outE.quantity) - totalMatched;
                const taking = Math.min(needed, available);
                totalMatched += taking;
                consumedInMap.set(m.id, (consumedInMap.get(m.id) || 0) + taking);
            }
            if (totalMatched > 0) {
                matchedOutMetrics.set(outE.id, { matched: totalMatched, mode: 'DIRECT_ID', score: 1.0 });
            }
        }

        // Step B: Confidence-Scored Fallback Matching (Orphan Legs)
        for (const outE of transfersOut) {
            const currentMatch = matchedOutMetrics.get(outE.id)?.matched || 0;
            const remainingNeeded = Math.abs(outE.quantity) - currentMatch;
            if (remainingNeeded <= 0.01) continue;

            const candidates = transfersIn.filter(inE => {
                const consumed = consumedInMap.get(inE.id) || 0;
                return (Math.abs(inE.quantity) - consumed) > 0.01;
            }).map(inE => {
                // Scoring Logic
                let score = 0;
                const timeDiffDays = Math.abs(new Date(inE.event_date).getTime() - new Date(outE.event_date).getTime()) / (1000 * 3600 * 24);
                if (timeDiffDays <= 14) score += 0.4;
                else if (timeDiffDays <= 30) score += 0.2;
                
                if (Math.abs(Math.abs(inE.quantity) - Math.abs(outE.quantity)) < 0.01) score += 0.3;
                if (inE.fulfillment_center_id && outE.fulfillment_center_id && inE.fulfillment_center_id !== outE.fulfillment_center_id) score += 0.2;
                if (!inE.reference_id || inE.reference_id === outE.reference_id) score += 0.1;

                return { event: inE, score };
            }).sort((a,b) => b.score - a.score);

            // Ambiguity check: suppress if top two are tied and low-confidence
            if (candidates.length > 1 && candidates[0].score < 0.6 && candidates[0].score === candidates[1].score) continue;

            for (const cand of candidates) {
                if (cand.score < 0.4) continue;
                const available = Math.abs(cand.event.quantity) - (consumedInMap.get(cand.event.id) || 0);
                const taking = Math.min(Math.abs(outE.quantity) - (matchedOutMetrics.get(outE.id)?.matched || 0), available);
                if (taking <= 0) continue;
                
                const prev = matchedOutMetrics.get(outE.id) || { matched: 0, mode: 'FALLBACK', score: 0 };
                matchedOutMetrics.set(outE.id, { 
                    matched: prev.matched + taking, 
                    mode: 'FALLBACK', 
                    score: Math.max(prev.score, cand.score) 
                });
                consumedInMap.set(cand.event.id, (consumedInMap.get(cand.event.id) || 0) + taking);
            }
        }

        // --- Final Tally ---
        let grossOut = 0; let matchedIn = 0; let matureUnresolved = 0;
        for (const outE of transfersOut) {
            const outQty = Math.abs(outE.quantity);
            const matched = matchedOutMetrics.get(outE.id)?.matched || 0;
            const diff = Math.max(0, outQty - matched);
            
            grossOut += outQty;
            matchedIn += matched;

            if (diff > 0.01) {
                const age = (syncTime - new Date(outE.event_date).getTime()) / (1000 * 3600 * 24);
                if (age >= MATURITY_WINDOW_DAYS) matureUnresolved += diff;
            }
        }

        let warehouseIn = 0; let warehouseOut = 0;
        let claimAdj = 0; let resolveAdj = 0;
        const fcs = new Set<string>();
        for (const e of sorted) {
            if (e.fulfillment_center_id) fcs.add(e.fulfillment_center_id);
            if (e.event_type === 'Snapshot' || e.event_type === 'Transfer') continue;
            const q = Math.abs(e.quantity);
            if (e.quantity_direction === 'in') {
                warehouseIn += q;
                if (e.event_type === 'Adjustment' && (['F', 'P'].includes(e.reason || '') || !e.reason)) resolveAdj += q;
            } else {
                warehouseOut += q;
                if (e.event_type === 'Adjustment' && (['M', 'E', 'D', 'N'].includes(e.reason || '') || !e.reason)) claimAdj += q;
            }
        }

        const actualBal = latestSnap?.warehouse_balance ?? 0;
        const balanceGap = latestSnap ? ((warehouseIn - warehouseOut) - actualBal) : 0;
        const netAdj = Math.max(0, claimAdj - resolveAdj);

        const physicalLoss = Math.max(0, matureUnresolved, balanceGap, netAdj);

        if (physicalLoss > 0.1) {
            const firstLossDate = sorted.find(e => e.quantity_direction === 'out')?.event_date || new Date().toISOString();
            const reData = findReimbursements(fnsku, data.financial_events || [], firstLossDate, sellerId, [...fcs][0]);
            
            let nettingFactor = 0;
            if (['DIRECT_ID', 'CAUSAL'].includes(reData.linkage)) nettingFactor = 1.0;
            else if (reData.linkage === 'PROBABLE') nettingFactor = 0.7;
            else if (reData.linkage === 'WEAK') nettingFactor = 0.3;

            const nettedUnits = reData.totalMatched * nettingFactor;
            const unresolved = Math.max(0, physicalLoss - nettedUnits);

            if (unresolved > 0.1) {
                const avgP = sorted.find(e => (e.average_sales_price || e.unit_cost))?.average_sales_price || 20;
                results.push({
                    seller_id: sellerId, sync_id: syncId,
                    anomaly_type: matureUnresolved >= Math.max(balanceGap, netAdj) ? 'lost_in_transit' : 'lost_warehouse',
                    severity: (unresolved * avgP >= 1000 ? 'critical' : unresolved * avgP >= 500 ? 'high' : 'medium'),
                    estimated_value: unresolved * avgP, currency: 'USD',
                    confidence_score: (latestSnap ? 0.95 : 0.85) + reData.modifier,
                    fnsku, sku: sorted[0].sku, asin: sorted[0].asin, product_name: sorted[0].product_name,
                    evidence_mode: latestSnap ? 'SNAPSHOT_CONFIRMED' : 'LEDGER_RECONCILED',
                    discovery_date: new Date(), deadline_date: new Date(Date.now() + 60*24*3600*1000), days_remaining: 60,
                    evidence: {
                        fnsku,
                        gross_transfer_out_units: grossOut,
                        matched_transfer_in_units: matchedIn,
                        mature_unresolved_transfer_units: matureUnresolved,
                        net_unresolved_units: unresolved,
                        reimbursement_linkage_mode: reData.linkage,
                        linkage_score: reData.modifier,
                        physical_loss_units: physicalLoss,
                        netted_reimbursement_units: nettedUnits
                    }
                });
            }
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
