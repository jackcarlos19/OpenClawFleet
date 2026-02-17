# OpenClaw Fleet Improvement Proposal

## 1) Executive Summary

The current OpenClaw Fleet is a **Functional MVP** composed of:
- 3 microservice agents:
  - `agents/voc_researcher/`
  - `agents/competitor_spy/`
  - `agents/supply_chain_watch/`
- 1 orchestrator:
  - `scripts/run_daily_briefing.ts`

This implementation successfully demonstrates the OpenClaw architecture patterns around:
- **Soul / Persona** via role-based prompts (for example `prompts/executive_summary.md`, `agents/competitor_spy/prompts/write_competitor_brief.md`)
- **Skill / Tooling** via reusable utilities (`agents/voc_researcher/src/utils/llm_client.ts`, copied to other agents)
- **Memory** via markdown state stores (`agents/voc_researcher/memory/MEMORY.md`, `agents/competitor_spy/memory/MEMORY.md`)

At the same time, the MVP currently depends on:
- **Mock data** (`agents/competitor_spy/data/competitor_ads_sample.json`, `agents/supply_chain_watch/data/inventory_sample.csv`)
- **File-system persistence** for reports, logs, and memory (`reports/`, `logs/`, `memory/`)

This is appropriate for rapid prototyping and demo validation, but not yet production-grade.

## 2) Architecture Review

### Strengths

- **Decoupled microservices**
  - Each agent runs independently via root `package.json` scripts (`spy:*`, `supply:*`, `extract:*`, etc.).
  - Failure isolation is strong: one agent crash does not hard-stop the others unless the orchestrator explicitly chains that step.

- **Cost-effective model splitting**
  - Lower-cost extraction/analyze paths use Haiku (`models.extraction` in agent `openclaw.json` files).
  - Higher-value synthesis uses Sonnet (`models.default` / `models.generation`).
  - This split appears in:
    - `agents/voc_researcher/openclaw.json`
    - `agents/competitor_spy/openclaw.json`
    - `agents/supply_chain_watch/openclaw.json`

- **Centralized LLM reliability handling**
  - Shared retry/backoff + schema repair logic in `llm_client.ts`:
    - `agents/voc_researcher/src/utils/llm_client.ts`
    - `agents/competitor_spy/src/utils/llm_client.ts`
    - `agents/supply_chain_watch/src/utils/llm_client.ts`
  - Reduces duplicated error-handling logic across scripts.

### Weaknesses

- **Data latency / realism**
  - Competitor pipeline currently reads static mock JSON from:
    - `agents/competitor_spy/data/competitor_ads_sample.json`
  - No live ingestion from ad libraries/scrapers, so trend freshness is limited.

- **Concurrency limits for memory writes**
  - `agents/competitor_spy/scripts/detect_new_angles.ts` directly rewrites:
    - `agents/competitor_spy/memory/MEMORY.md`
  - Without locking/transaction boundaries, concurrent writes may race and lose updates at moderate scale (>10 concurrent runs).

- **Observability scope**
  - Local CLI status is helpful (`agents/voc_researcher/scripts/report_status.ts`), but this is file-based and local-process oriented.
  - No centralized event store, queryable run history, or alert pipeline for multi-node production (Datadog/Postgres equivalent still absent).

## 3) Risk Assessment

### Security

- **Current state**
  - `.env` usage and `.gitignore` controls are in place.
  - Secrets are consumed from environment variables by runtime scripts.

- **Risk**
  - If moved to cloud or CI runners, static tokens may leak via logs, shell history, or misconfigured secrets scopes.

- **Action**
  - Implement routine key rotation and secret-scoped runtime identities before hosted deployment.

### Compliance

- **Current state**
  - Prompts include compliance guidance, especially for ad output and claims.
  - Example files:
    - `agents/voc_researcher/prompts/generate_brief.md`
    - `agents/voc_researcher/briefs/creative_brief_*.json`

- **Risk**
  - Orthopedic footwear is a health-adjacent niche; generated content can drift into medical/therapeutic claims.

- **Action**
  - Add deterministic claim-scanning + legal review gate before campaign publication.

## 4) 30-Day Roadmap (Fix Plan)

### Week 1 - Data Bridges

- [ ] Replace competitor mock source with Apify Facebook ads ingestion
  - Target script: `agents/competitor_spy/scripts/analyze_competitors.ts`
  - Replace input dependency on `agents/competitor_spy/data/competitor_ads_sample.json`

- [ ] Replace inventory CSV mock with Shopify Admin API (read-only)
  - Target script: `agents/supply_chain_watch/scripts/check_inventory.ts`
  - Replace dependency on `agents/supply_chain_watch/data/inventory_sample.csv`

### Week 2 - Infrastructure

- [ ] Dockerize fleet for AWS Lambda/ECS-compatible execution units
  - Package each agent independently with env-driven config.

- [ ] Implement GitHub Actions CI/CD
  - Mandatory checks: linting + type checking
  - Wire for root + `agents/*` script surfaces.

### Week 3 - Intelligence

- [ ] Upgrade `MEMORY.md` approach to vector-backed RAG (Pinecone)
  - Migrate from markdown append model to indexed retrieval for scale and recall.

- [ ] Add closed-loop A/B feedback ingestion
  - Connect generated creative outputs to performance outcomes.
  - Feed conversion learnings back into prompt/memory strategy.

---

### Recommended Success Criteria for End of 30 Days

- [ ] Live external data ingestion for competitor and inventory pipelines
- [ ] Containerized deployment pipeline with CI gates
- [ ] Centralized telemetry for run health and costs
- [ ] Automated compliance gating for health-claim risk
- [ ] Learning loop from creative output to real conversion metrics
