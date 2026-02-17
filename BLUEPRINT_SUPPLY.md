# OpenClaw Agent #3: Supply Chain Watchdog

This agent monitors inventory levels against sales velocity to prevent "Ad Spend Waste" (advertising out-of-stock products).

## 🎯 Objective
To ingest inventory data, identify SKUs with low "Days of Stock" (DoS), and generate an operational alert.

## 🏗 Architecture
1.  **Ingest:** Read `data/inventory_sample.csv` (SKU, Stock Level, Daily Sales Velocity).
2.  **Logic (TypeScript):** Calculate `Days of Stock = Stock / Velocity`.
    - Flag any SKU with **< 10 Days** of stock.
3.  **Report (Haiku):** Write a `daily_inventory.md` report.
    - *Critical:* If stock is low, recommend "PAUSE ADS" for that SKU.

## 📂 Fleet Structure
- Lives in: `agents/supply_chain_watch/`
- Outputs to: `reports/daily_inventory.md`

## Phase 1: Environment & Mock Data
- [ ] **Scaffold:** Standard agent structure.
- [ ] **Data:** `data/inventory_sample.csv`
    - `SKU-101 (Comfort-Pro), Stock: 50, Velocity: 10` (5 Days left -> **DANGER**)
    - `SKU-102 (Night-Shift), Stock: 500, Velocity: 5` (100 Days left -> SAFE)

## Phase 2: The Logic Script
- [ ] **Script:** `scripts/check_inventory.ts`
    - Read CSV.
    - Filter for `DoS < 14`.
    - If danger detected, use `llm_client` (Haiku) to write a warning report.
    - Save to `reports/daily_inventory.md`.

## Phase 3: Wiring
- [ ] **Package.json:** Add `"supply:check": "tsx agents/supply_chain_watch/scripts/check_inventory.ts"`
