# Operator Runbook

## Weekly Workflow (Monday Morning)

1. Drop the newest review CSV into `data/` (for example: `data/reviews_YYYYMMDD.csv`).
2. Verify environment and API health:
   - `npm run verify`
3. Run ingestion:
   - `npm run ingest:reviews -- "data/reviews_YYYYMMDD.csv"`
4. Run extraction:
   - `npm run extract:insights -- "data/clean_reviews_YYYYMMDD.jsonl"`
5. Run aggregation:
   - `npm run aggregate:insights -- "insights/raw_insights_YYYYMMDD.jsonl"`
6. Run creative generation:
   - `npm run generate:brief -- "insights/summary_YYYYMMDD.json"`
7. Optional delivery (choose one):
   - Slack dry run: `npm run deliver:slack -- --dry-run`
   - Telegram dry run: `npm run deliver:telegram -- --dry-run`
8. Check health and costs:
   - `npm run status`
9. Share `briefs/creative_brief_YYYYMMDD.md` with stakeholders for review.

## Troubleshooting

### If Safe Mode triggers

- Symptom: brief generation is skipped and `briefs/skipped_YYYYMMDD.json` is created.
- Action:
  1. Inspect `insights/summary_YYYYMMDD.json`.
  2. Confirm pain-point fields are populated.
  3. If empty, check the input CSV for empty/malformed review content and rerun ingest/extract.

### If Slack fails

- Symptom: no message appears in Slack.
- Action:
  1. Check `logs/delivery_errors.jsonl`.
  2. Confirm `SLACK_WEBHOOK_URL` is set and valid.
  3. Re-test with `npm run deliver:slack -- --dry-run`, then run live send again.

### If Telegram fails

- Check `logs/delivery_errors.jsonl` for details.
- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Run `npm run deliver:telegram -- --dry-run` to validate formatting before retry.

### If extraction has failures

- Inspect `logs/extraction_errors.jsonl`.
- Re-run extraction with lower concurrency:
  - `npm run extract:insights -- "data/clean_reviews_YYYYMMDD.jsonl" --concurrency=2`

### If costs spike

- Run `npm run status`.
- If `⚠️ HIGH COST DETECTED` appears, pause non-essential runs and review model usage in logs.
