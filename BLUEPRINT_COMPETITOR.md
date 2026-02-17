# OpenClaw Agent #2: Competitor Intelligence Spy

This blueprint outlines the construction of the "Competitor Spy" agent. Its sole purpose is to monitor competitor ad creative, identify new angles, and alert the team.

## 🎯 Objective
To autonomously analyze competitor ad copy and visuals to answer: *"What new angles are they testing this week?"*

## 🏗 Architecture
1.  **Ingest:** Read competitor ad data (Mock JSON for MVP / Apify API for Prod).
2.  **Analyze (Haiku):** Tag ads with "Angle," "Hook Type," and "Estimated Spend."
3.  **Aggregate (TS):** specificially look for *new* angles not seen in `MEMORY.md`.
4.  **Report (Sonnet):** Write a tactical `daily_competitor.md` report.

## 📂 Fleet Structure Integration
This agent lives in `agents/competitor_spy/`.
It outputs to the shared `reports/` folder.

---

## Phase 1: Environment & Mock Data (Day 1)
- [ ] **Scaffold:** Create `agents/competitor_spy/` with standard structure (`src/`, `prompts/`).
- [ ] **Mock Data:** Create `data/competitor_aple.json`.
    - Include 5 examples: 2 "Medical/Science" ads, 2 "Emotional/Family" ads, 1 "Discount" ad.
- [ ] **Config:** Add `competitor_spy` entry to `openclaw.json` (inherits logging/model configs).

## Phase 2: The Analysis Pipeline (Day 2)
- [ ] **Schema:** Define `CompetitorAdAnalysis` (angle, hook_type, aggression_score).
- [ ] **Prompt:** `prompts/analyze_ad.md` (Role: "Expert Media Buyer").
- [ ] **Script:** `scripts/analyze_competitors.ts`.
    - Input: `data/competitor_ads_sample.json`.
    - Process: Send ad text to Claude Haiku.
    - Output: `insights/competitor_analysis_YYYYMMDD.json`.

## Phase 3: The "Delta" Engine (Day 3)
*This is the "Senior Engineer" feature.*
- [ ] **Memory:** Create `agents/competitor_spy/MEMORY.md`.
    - Stores "Known Angles" (e.g., "They always use the 'Cloud Foam' angle").
- [ ] **Logic:** `scripts/detect_new_angles.ts`.
    - Compare *today's* analysis vs. `MEMORY.md`.
    - Filter for ONLY the angles that are "New" or "Trending Up."

## Phase 4: Reporting (Day 4)
- [ ] **Generate:** `scripts/write_competitor_brief.ts`.
    - Use Claude Sonnet to summarize the "New Angles."
    - **Constraint:** Output must be a Markdown file saved to `reports/daily_competitor.md` (ready for the Manager Agent).

## Phase 5: Runbook & Verify (Day 5)
- [ ] **Runbook:** Add section to `docs/RUNBOOK.md`.
- [ ] **Verify:** Run the full pipeline and check `reports/daily_competitor.md`.
