Remaining Build Specification

This document describes the additional components required to bring the OpenClaw agent fleet up to the standards described in the job post.  It picks up where the existing implementation leaves off, focusing on the missing deliverables identified in the audit.  Each section below outlines what to build, why it matters, and concrete steps to complete the work.  Treat this as an engineering backlog—items can be tackled in parallel where appropriate.

1. Audit & Improvement Proposal (docs/improvement_proposal.md)

Goal: Provide a concise report of the current OpenClaw setup, highlight weaknesses and risks, and recommend improvements.  This document should be delivered in the first few days of work and will serve as the foundation for future optimisation.

Steps:
	1.	State of the Fleet
	•	Summarise each existing agent (voc_researcher, competitor_spy, supply_chain_watch) and the manager script.  Include their responsibilities, inputs/outputs, and any assumptions (e.g. mock data vs real APIs).
	•	Document the current configuration (openclaw.json files), model assignments, and logging settings.
	•	Note the structure of memory files (daily logs vs. MEMORY.md) and how they are loaded during execution ￼ ￼.
	2.	Gap Analysis
	•	Identify missing artefacts (no AGENTS.md files, no SQL‑backed logs, no dashboard, etc.).
	•	Check for brittle assumptions—e.g. competitor agent uses hard‑coded JSON rather than scraping actual ads.
	•	Review the cost profile from recent runs using report_status.ts.  Estimate monthly expenditure if scaled to daily use.
	3.	Risks
	•	Highlight security risks (hard‑coded API keys, PII handling, absence of environment variable validation in some scripts).
	•	Note any reliability concerns: concurrency settings, error handling coverage, memory file bloat, etc.
	•	Address compliance: ensure generated ads do not make prohibited health claims.
	4.	Recommendations
	•	Propose implementing the items in this specification (sections 2–9 below).
	•	Suggest a tiered model strategy to optimise cost (see Section 6).
	•	Recommend migrating logging to a database to support metrics and alerting.
	•	Advise integrating real data sources (Apify for competitor ads, Shopify/ERP for inventory) to remove manual data entry.

Deliver this report as docs/improvement_proposal.md with clear headings and bullet points.  Include any immediate fixes you have already applied.

2. Structured Workflow Documentation

Goal: Provide engineering documentation that clearly describes each agent’s pipeline.  This ensures future contributors can understand and modify the system without guesswork.

2.1 workflows/voc_creative_pipeline.md
	1.	High‑Level Overview
	•	Explain the purpose of the VoC agent (turn customer reviews into actionable creative briefs).
	•	Include an ASCII diagram showing the stages: Ingest → Extract → Aggregate → Generate → Deliver.
	2.	Stage Details
	•	Ingest: Describe the expected CSV schema and any optional columns.  Explain duplicate removal, PII masking, language detection and the output JSONL format.
	•	Extract: Detail the extraction schema (review_insight.schema.json) and the prompt used.  Note concurrency controls, retry logic and failure logging.
	•	Aggregate: Explain how the script tallies pain points, jobs‑to‑be‑done and shift contexts; how quotes are selected; and the format of the summary JSON.
	•	Generate: Describe the creative brief schema, the system prompt template with memory injection, and safe‑mode fallback if insufficient data exists.
	•	Deliver: Cover Slack/Telegram posting, the structure of the Slack payload and error logging.
	3.	Memory & Scheduling
	•	Clarify which memory files are loaded (memory/YYYY‑MM‑DD.md for recent context and MEMORY.md for durable knowledge) ￼ ￼.
	•	Note how often the agent should run (e.g. daily at 08:00 UTC).  Reference how to configure this using HEARTBEAT.md or a cron in OpenClaw.
	4.	Error & Cost Considerations
	•	Summarise retry strategy, safe‑mode, and logs.  Provide guidelines for acceptable per‑run cost thresholds.

Repeat a similar structure for competitor_spy and supply_chain_watch in their own documents (workflows/competitor_spy_pipeline.md and workflows/supply_chain_watch_pipeline.md).

3. Logging Ingestion & Dashboard

Goal: Move from flat JSONL files to a searchable, queryable data store with visual monitoring.  Provide alerts when costs spike or errors occur.

Steps:
	1.	Design a Database Schema
	•	Create a logs table with columns: id, timestamp, agent, script, model, input_tokens, output_tokens, cost, success, message.
	•	Create an errors table (or use success=false in the main table) to capture error details.
	•	Optionally create a runs table summarising each end‑to‑end pipeline execution.
	2.	Implement scripts/log_ingest.ts
	•	Read all JSONL files from each agent’s logs/ directory.
	•	Parse each line, infer the fields as in report_status.ts (script name, success, token counts, etc.), calculate cost and insert into the database.
	•	Mark lines as processed to avoid duplicate ingestion (e.g. move them to logs/archived/).
	3.	Create a Minimal Dashboard
	•	Use a lightweight framework (Next.js, Express with EJS, or a Python Flask app) to display:
	•	Runs per day (bar chart)
	•	Success/failure counts
	•	Total and average cost per run
	•	Top errors
	•	Recent logs table with filtering (by agent, date range, success)
	•	Add a settings page to configure cost thresholds.
	4.	Set Up Alerts
	•	Implement a script (scripts/check_costs.ts) that queries the database for the last run’s cost and compares it to a configured threshold.  If exceeded, send a Slack alert with details of the run.
	•	Schedule this script using OpenClaw’s heartbeat/cron or an external cron job.
	5.	Documentation
	•	Provide setup instructions for the database (SQLite for local dev, Postgres for production).  Include environment variables for connection details.
	•	Document how to run log_ingest.ts after each agent execution or via a cron schedule.

4. Real Data Integration

4.1 Competitor Ads

Goal: Replace mock JSON with live competitor ads.  The goal is to detect emerging angles in near‑real‑time.
	1.	Source Selection
	•	Evaluate APIs like Apify’s Facebook Ads scraper￼ or Meta’s Ad Library.  Choose one that provides structured creative data (headline, text, image description, spend tier).  Ensure the API is permissible to use under its terms of service.
	•	Document API credentials and rate limits.
	2.	Ingestion Script
	•	Create scripts/fetch_competitor_ads.ts in agents/competitor_spy.  It should call the selected API, fetch ads matching specified keywords or brand IDs, normalise the fields, and write them to data/competitor_ads_YYYYMMDD.json.
	•	Add this script to package.json as spy:fetch.  Make it idempotent and safe to rerun.
	3.	Update Pipeline
	•	Modify analyze_competitors.ts to load the latest fetched file instead of the static sample.
	•	Make any necessary adjustments to the schema if the API returns additional fields (e.g. placement, call‑to‑action).  Preserve unknown fields for future use.

4.2 Inventory Data
	1.	Source Selection
	•	Determine the source of truth for inventory (e.g. Shopify, Amazon Seller Central, ERP).  Confirm API credentials and data fields (SKU, stock level, sales velocity).
	2.	Fetch Script
	•	Create scripts/fetch_inventory.ts in agents/supply_chain_watch.  It should query the selected API for current stock and recent sales velocity, normalise the fields, and write a CSV (or JSON) to data/inventory_YYYYMMDD.csv.
	•	Add this script to package.json as supply:fetch.  Provide options for date range if supported by the API.
	3.	Update Pipeline
	•	Modify check_inventory.ts to load the latest fetched file instead of the static sample.
	•	Ensure fallback to sample data remains available for testing.

5. Agent Definitions (AGENTS.md and Scheduling)

Goal: Formalise each agent’s contract with the OpenClaw gateway.  This file guides the runtime about which tools to load, how often to run and which memory files to read.
	1.	Create AGENTS.md in each agent folder
	•	Purpose & Role: Describe the agent’s mission in one sentence.
	•	Tools: List the built‑in tools it can access (e.g. file reader/writer, Slack webhook, HTTP client).  Explicitly state that it should not call external websites unless integrated via an authorised API.
	•	Memory: Define which files to load into context (memory/YYYYMMDD.md for today and yesterday, plus MEMORY.md for durable knowledge).  Explain that only data written to disk becomes part of long‑term memory ￼.
	•	Schedule: Specify if the agent runs on heartbeat (periodic proactivity), cron (exact time) or only via manual invocation.  Include examples.
	•	Safety & Guardrails: Describe any restrictions (max tokens per call, fields that must be present before proceeding, safe‑mode triggers).
	2.	Heartbeat & Cron Files
	•	For agents that require periodic runs (e.g. competitor spy daily, supply watch daily), create HEARTBEAT.md with guidelines: frequency (daily at 08:00 local time) and tasks to perform (fetch data, analyze, report).  Use CRON.md for fixed times if needed.
	•	Document how to configure these schedules in openclaw.json or the hosting scheduler.

6. Cost Optimisation Strategy

Goal: Keep operating expenses predictable and manageable by applying model selection and prompt trimming.
	1.	Tiered Model Usage
	•	Set openclaw.json defaults to use anthropic/claude-3-haiku for extraction tasks and anthropic/claude-3.5-sonnet for generation.  Document why this is chosen (Haiku is cheaper for small classification tasks; Sonnet provides better creative output).
	•	Expose environment variables (EXTRACT_MODEL_ID, GENERATE_MODEL_ID) to override these defaults without code changes.
	2.	Prompt Pruning
	•	Review all prompts (extract_review.md, generate_brief.md, analyze_ad.md, etc.) and remove superfluous text.  Ensure instructions are clear but concise.
	•	Aim to keep system prompts under ~600 words and user prompts under ~200 words where possible without sacrificing clarity.
	3.	Token Accounting & Alerts
	•	Extend the logging ingestion to record cumulative cost per run.  Provide average cost per record for extraction and per brief generation.
	•	Define a cost threshold (e.g. $2 per daily run).  If exceeded, trigger a Slack alert (see Section 3).
	•	Consider caching extraction results (e.g. by review ID hash) to avoid repeated model calls on unchanged reviews.

7. Testing & Quality Assurance

Goal: Reduce regressions and ensure reliability by adding automated tests and linting.
	1.	Unit Tests
	•	Use Jest (if staying in Node) or a Python testing framework to write unit tests for each script.
	•	Mock API calls to OpenRouter, Slack, and external data sources to test error paths and success paths.
	•	Test schema validation: feed malformed input and verify that errors are logged correctly without crashing the pipeline.
	2.	Integration Tests
	•	Create a test harness that runs the entire pipeline against a small fixture dataset and asserts that all expected outputs (JSON and MD files) are created, schemas are satisfied and logs contain success messages.
	3.	Static Analysis & Linting
	•	Add ESLint/Prettier configuration to enforce consistent code style and catch obvious issues.
	•	Include npm run lint and integrate into CI (e.g. GitHub Actions) so that pull requests are automatically checked.

8. Deployment & Environment Management

Goal: Prepare the project for deployment on local machines or cloud servers in a repeatable way.
	1.	Dockerisation
	•	Create a Dockerfile that installs Node.js, copies the repo, installs dependencies, and sets up an entrypoint for running the manager script or individual agents.
	•	Use multi‑stage builds to reduce final image size.  Ensure no secrets are baked into the image.
	2.	Environment Variables
	•	Provide a .env.example file with documented variables (API keys, webhook URLs, database connections, model IDs, cost thresholds).
	•	Update verify_env.ts to check for all required variables at startup and provide actionable error messages if any are missing.
	3.	CI/CD
	•	Write a GitHub Actions workflow that runs tests, lints code, and builds the Docker image.  Publish the image to a registry if desired.
	•	Optionally trigger a test deployment (e.g. to a staging server) after merges to the main branch.

9. Enhancements & Future Work

While the above tasks focus on meeting the immediate job requirements, consider these stretch goals:
	1.	Embedding & RAG: Build an embedding pipeline that stores past insights in a vector database, enabling retrieval‑augmented generation of creative briefs that reference historical patterns.
	2.	User Interface: Develop a simple web UI where non‑technical team members can upload CSVs, run agents, and view reports and dashboards.
	3.	A/B Testing Integration: Add a module to track performance metrics (e.g. CTR, CPA) for each generated ad angle.  Use these metrics to inform future briefing generations.

