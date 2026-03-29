Amazon CSV Demo Pack

Purpose

This pack is for lighting up the CSV ingestion and detection pipeline when a live Amazon account has little or no sales history.

What this pack is designed to trigger

- `refund_no_return`
- `shipment_shortage`
- `shipment_missing`
- `lost_in_transit`
- `lost_warehouse`
- `warehouse_transfer_loss`

Recommended upload flow

1. Open the tenant workspace `Data Upload` page.
2. Upload all `.csv` files in this folder together.
3. Let auto-detect classify them by headers.
4. Wait for detection to complete.

Files

- `01_orders.csv`
- `02_settlements.csv`
- `03_returns.csv`
- `04_shipments.csv`
- `05_inventory_ledger.csv`
- `06_transfers.csv`

Scenario summary

- Refund without return:
  - `DEMO-ORDER-1003` has a refund in settlements but no matching return row.
- Inbound shipment shortage:
  - `INB-DEMO-001` shipped more than it received and is old enough to be claimable.
- Entire inbound shipment missing:
  - `INB-DEMO-002` is closed, old, and shows zero units received.
- Inventory lost in transit:
  - `DEMO-FNSKU-TR-01` has an old transfer-out with only a partial transfer-in.
- Inventory lost in warehouse:
  - `DEMO-FNSKU-ADJ-01` has an unresolved negative adjustment.
- Warehouse transfer loss:
  - `TL-DEMO-100` and `TL-DEMO-200` show partial and total transfer loss.

Notes

- This pack is for pipeline testing, not for replacing live SP-API truth.
- Dates are intentionally old enough to satisfy detection maturity windows.
- Currency is `USD` because most fee and recovery formatting defaults there cleanly.
