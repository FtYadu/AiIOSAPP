# Queue & Provider Operations Runbook

On-call engineers can use this guide to diagnose delivery regressions across the RabbitMQ queue, provider executors, and downstream webhooks.

## Dashboards & Key Metrics

- **Queue throughput**: Prometheus chart on `imagen_queue_latency_seconds` (labelled by `provider`, `transport`, `outcome`). Watch for sustained latency >60s or spikes in the `failure` series.
- **Mask ingestion**: Counter `queue_mask_uploads` surfaces mask demand. Unexpected drops usually correlate with client regressions.
- **Webhook health**: Counter `webhook_dispatch_failures` (labels `provider`, `status`). Alerts fire when failures exceed 5/minute for 10 minutes.
- **Provider error rate**: Counters `provider.<name>.error` emit with `mode`/`status`/`reason` tags for targeted triage. Drill into logs with the same labels.
- **Queue depth**: CloudAMQP dashboard (RabbitMQ `my-tasks`) should remain <1,000 messages. Cloud Run autoscaling handles bursts; coordinate with SRE if backlog persists >5 minutes.

## Alert Thresholds

| Signal | Threshold | Action |
| --- | --- | --- |
| `imagen_queue_latency_seconds{outcome="failure"}` | >30s p95 for 3 consecutive scrapes | Investigate worker logs for provider outages. Consider disabling affected provider via remote config. |
| `queue_mask_uploads` | 50% drop over rolling hour | Check recent app releases; masks may fail to upload. Validate S3/minio availability. |
| `webhook_dispatch_failures` | >5/min sustained | Verify partner endpoint health; temporarily disable webhooks via feature flag if response codes 5xx. |
| `provider.*.error` | >2% of invocations over 10 minutes | Engage provider owner, review executor logs, and check upstream status pages. |

## Rollout & Recovery Steps

1. **Confirm backlog**
   - Review RabbitMQ queue depth. If messages >1k and rising, scale Cloud Run worker revision to max instances (20) and ensure new pods are starting.
   - Inspect `queue.job.failure` logs grouped by `error_tag` to isolate provider vs infrastructure faults.
2. **Retry tuning**
   - Workers retry up to `QUEUE_MAX_RETRIES` (default 5) with exponential backoff starting at `QUEUE_INITIAL_BACKOFF_MS` (default 500ms).
   - Dead-lettered messages land in `${RABBITMQ_QUEUE}.dlq`. Drain manually once root cause resolved (`rabbitmqadmin get queue=<dlq>` or via UI) and requeue as needed.
3. **Webhooks**
   - Check `webhook.dispatcher` logs for partner downtime. Pause webhook dispatch via remote config, or add `429`/`503` handling rules if partners enforce rate limits.
4. **Provider-specific triage**
   - Use structured logs (`module=providerWorker`) to inspect executor duration and status.
   - For asset issues (mask/base uploads), review `imageEdits.upload` logs and ensure S3 latency is within expectations.
5. **Deployment rollback**
   - GitHub Actions publishes `cloud-run-rabbitmq-bundles` artifacts on each run (`gateway-dist.tar.gz`, `rabbit-worker-dist.tar.gz`). Re-deploy the last known-good bundle to Cloud Run if a release causes regressions.

## Escalation

- Notify #imagen-sre on Slack with the affected provider, observed metrics, and current mitigation steps.
- Escalate to the provider owner (PromptKit/OpenAI, ModelKit/Gemini, etc.) if failures persist beyond 15 minutes or align with external outages.
