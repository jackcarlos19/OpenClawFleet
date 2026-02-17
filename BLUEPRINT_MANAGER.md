# OpenClaw Manager: The Chief of Staff

This script orchestrates the fleet. It executes all sub-agents, reads their individual reports, and synthesizes a "State of the Union" executive summary.

## 🎯 Objective
To save the CEO from reading 3 different reports. One message, 2 minutes to read, high-impact decisions only.

## 🏗 Workflow
1.  **Execute:** Run `npm run extract:insights` -> `generate:brief` -> `spy:report` -> `supply:check` sequentially.
    - *Note:* In production, these run in parallel, but for MVP we run serial to save API rate limits.
2.  **Read:** Ingest `reports/daily_voc.md`, `reports/daily_competitor.md`, `reports/daily_inventory.md`.
3.  **Synthesize (Sonnet):**
    - "Given these 3 reports, what are the top 3 priorities today?"
    - *Conflict Resolution:* If Supply says "Pause Ads" but VoC says "Launch New Creative," the Manager must flag this conflict.
4.  **Deliver:** Send the final summary to Slack.

## 📂 Structure
- Script: `scripts/run_daily_briefing.ts`
- Output: Slaification (Block Kit)

## Phase 1: Logic
- [ ] **Orchestrator:** A script that spawns child processes to run the other agents.
- [ ] **Synthesizer:** A prompt "You are the Chief of Staff..." that takes 3 text inputs.
- [ ] **wiring:** `npm run morning:brief`.
