---
name: bitagent-android
description: Operate the loopback BitAgent candidate interface from Hermes on Android without wallet approval, signing, execution, broadcast, or secret access.
---

# BitAgent Android candidate-only operations

Use the reviewed helper at:

```bash
python ~/.hermes/skills/bitagent-android/scripts/bitagent_candidate.py --help
```

The helper is fixed to `http://127.0.0.1:8787` and exposes only workflow
inspection, planning, DAG task construction, and deterministic candidate
validation. Do not replace it with direct `curl` calls to `/api/tools`.

For every operation:

1. Inspect or start the workflow.
2. Ask BitAgent for a plan or DAG task.
3. Produce at most one `bitagent.dag_candidate.v2` proposal.
4. Submit it only to `validate`.
5. If approval or an external effect is next, stop and direct the user back to
   the TradeLayer Mobile wallet surface.

Hermes must never approve, sign, execute, broadcast, request a seed phrase or
private key, read wallet RPC credentials, or claim a proposal was executed.
The valid sequence remains:

`explain -> simulate -> display exact effects and fees -> wallet approval -> host execution -> deterministic verification`

The first five helper commands are effect-free:

```bash
python ~/.hermes/skills/bitagent-android/scripts/bitagent_candidate.py health
python ~/.hermes/skills/bitagent-android/scripts/bitagent_candidate.py start
python ~/.hermes/skills/bitagent-android/scripts/bitagent_candidate.py get WORKFLOW_ID
python ~/.hermes/skills/bitagent-android/scripts/bitagent_candidate.py plan WORKFLOW_ID "message"
python ~/.hermes/skills/bitagent-android/scripts/bitagent_candidate.py task WORKFLOW_ID "message"
```

Candidate validation reads one JSON file and does not execute it:

```bash
python ~/.hermes/skills/bitagent-android/scripts/bitagent_candidate.py validate \
  WORKFLOW_ID "message" candidate.json
```
