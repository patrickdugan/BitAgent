#!/usr/bin/env bash
set -euo pipefail

workspace="${BITAGENT_POD_WORKSPACE:-/home/ubuntu/bitagent-referral-disposition-v2}"
python_bin="${BITAGENT_POD_PYTHON:-python3}"
split="${BITAGENT_EVAL_SPLIT:?BITAGENT_EVAL_SPLIT is required}"
request_sha="${BITAGENT_REQUEST_SHA256:?BITAGENT_REQUEST_SHA256 is required}"
request_rows="${BITAGENT_REQUEST_ROWS:?BITAGENT_REQUEST_ROWS is required}"
candidate_sha="${BITAGENT_CANDIDATE_SHA256:?BITAGENT_CANDIDATE_SHA256 is required}"
eval_dir="$workspace/eval-$split"
requests="$workspace/$split-requests.jsonl"

case "$split" in
  development|heldout) ;;
  *) echo "unsupported split" >&2; exit 2 ;;
esac
test -f "$requests"
test ! -e "$workspace/$split-oracle.jsonl"
test "$(sha256sum "$requests" | cut -d' ' -f1)" = "$request_sha"
test "$(sha256sum "$workspace/baseline-adapter/adapter_model.safetensors" | cut -d' ' -f1)" = "ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be"
test "$(sha256sum "$workspace/candidate-adapter/adapter_model.safetensors" | cut -d' ' -f1)" = "$candidate_sha"
install -d -m 700 "$eval_dir"

for candidate in baseline_v3 referral_disposition_v2; do
  if [ "$candidate" = "baseline_v3" ]; then
    adapter="$workspace/baseline-adapter"
    adapter_sha="ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be"
  else
    adapter="$workspace/candidate-adapter"
    adapter_sha="$candidate_sha"
  fi
  shard_dir="$eval_dir/$candidate-shards"
  install -d -m 700 "$shard_dir"
  pids=()
  for shard_index in 0 1; do
    timeout --signal=TERM --kill-after=60s 900s \
      "$python_bin" "$workspace/infer-referral-steering-disposition-v2.py" \
        --requests "$requests" \
        --adapter "$adapter" \
        --candidate "$candidate" \
        --output "$shard_dir/shard-$shard_index.predictions.jsonl" \
        --expected-adapter-sha256 "$adapter_sha" \
        --expected-requests-sha256 "$request_sha" \
        --expected-rows "$request_rows" \
        --seed 20260812 \
        --shard-index "$shard_index" \
        --shard-count 2 \
        > "$shard_dir/shard-$shard_index.log" 2>&1 &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
  "$python_bin" "$workspace/combine-referral-disposition-v2-predictions.py" \
    --requests "$requests" \
    --candidate "$candidate" \
    --shard "$shard_dir/shard-0.predictions.jsonl" \
    --shard "$shard_dir/shard-1.predictions.jsonl" \
    --output "$eval_dir/$candidate.predictions.jsonl"
done

"$python_bin" - "$eval_dir" "$split" <<'PY'
import datetime
import json
import pathlib
import sys

eval_dir = pathlib.Path(sys.argv[1])
split = sys.argv[2]
(eval_dir / "evaluation_exit_receipt.json").write_text(json.dumps({
    "schema": "bitagent.referral_disposition_evaluation_exit.v2",
    "split": split,
    "status": "completed",
    "oracle_labels_present": False,
    "wallet_chain_contact_or_send_access": False,
    "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, indent=2) + "\n", encoding="utf-8")
PY
