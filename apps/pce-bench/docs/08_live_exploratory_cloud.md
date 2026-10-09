# 08 — Live exploratory run (cloud): not attempted

## Attempt 2 (2026-10-09, branch `pce-bench` at `3c42ec9`, second default cloud environment)

Stopped at step 1 (credentials). This environment, the second default cloud environment tried, also has no Anthropic API credential: the `ant` CLI is not installed, and neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` is set, so the `anthropic` Python SDK cannot authenticate. No tests, smoke runs, judge admission or dev-pack episodes were executed and no API spend was incurred.

To enable the run, the user needs to add `ANTHROPIC_API_KEY` to a cloud environment, as a network secret (labelled "API credentials" in older app versions) or, where that section is not offered, as an environment variable: open the cloud environment menu in the session title bar, choose Edit, and add it there. A new session picks it up, after which the scheduled task can be re-fired unchanged, pointed at that environment.

## Attempt 1 (2026-10-09, branch `pce-bench` at `ce797e0`)

Not attempted for the same reason: no `ant` CLI, and neither `ANTHROPIC_API_KEY` nor `ANTHROPIC_AUTH_TOKEN` set. No spend.
