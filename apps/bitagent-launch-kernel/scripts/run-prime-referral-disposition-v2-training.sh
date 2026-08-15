#!/usr/bin/env bash
set -euo pipefail

workspace="${BITAGENT_POD_WORKSPACE:-/home/ubuntu/bitagent-referral-disposition-v2}"
python_bin="${BITAGENT_POD_PYTHON:-python3}"
output="$workspace/output"

write_exit_receipt() {
  exit_code=$?
  set +e
  "$python_bin" - "$workspace" "$exit_code" <<'PY'
import datetime
import json
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
exit_code = int(sys.argv[2])
(workspace / "run_exit_receipt.json").write_text(json.dumps({
    "schema": "bitagent.referral_disposition_prime_exit.v2",
    "status": "completed" if exit_code == 0 else "aborted_or_failed",
    "exit_code": exit_code,
    "wallet_chain_contact_or_send_access": False,
    "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}, indent=2) + "\n", encoding="utf-8")
PY
  exit "$exit_code"
}
trap write_exit_receipt EXIT

test -f "$workspace/requirements.txt"
test -f "$workspace/train-referral-steering-disposition-v2.py"
test -f "$workspace/train.jsonl"
test -f "$workspace/validation.jsonl"
test -f "$workspace/source-adapter/adapter_model.safetensors"
test ! -e "$workspace/development-requests.jsonl"
test ! -e "$workspace/heldout-requests.jsonl"
test ! -e "$workspace/development-oracle.jsonl"
test ! -e "$workspace/heldout-oracle.jsonl"

test "$(sha256sum "$workspace/train.jsonl" | cut -d' ' -f1)" = "36a8cd950872d54f488e812fdb55a2cbf19b4339e124b815a4159bb6933a1a73"
test "$(sha256sum "$workspace/validation.jsonl" | cut -d' ' -f1)" = "1eb960b5c539df2027e6b66d74d57450e7e8d80e03af22d5fab416720ff9663a"
test "$(sha256sum "$workspace/source-adapter/adapter_model.safetensors" | cut -d' ' -f1)" = "ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be"

if ! "$python_bin" -m pip --version >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip
fi
"$python_bin" -m pip install --no-cache-dir --disable-pip-version-check \
  torch==2.7.1 --index-url https://download.pytorch.org/whl/cu126
"$python_bin" -m pip install --no-cache-dir --disable-pip-version-check -r "$workspace/requirements.txt"

"$python_bin" "$workspace/train-referral-steering-disposition-v2.py" \
  --train "$workspace/train.jsonl" \
  --validation "$workspace/validation.jsonl" \
  --source-adapter "$workspace/source-adapter" \
  --output "$workspace/preflight" \
  --preflight-only

timeout --signal=TERM --kill-after=60s 1800s \
  nice -n 5 "$python_bin" "$workspace/train-referral-steering-disposition-v2.py" \
    --train "$workspace/train.jsonl" \
    --validation "$workspace/validation.jsonl" \
    --source-adapter "$workspace/source-adapter" \
    --output "$output" \
    --training-task-id bitagent-referral-disposition-v2 \
    --max-seq-length 1024 \
    --epochs 4 \
    --learning-rate 0.0001 \
    --gradient-accumulation 4 \
    --save-steps 8 \
    --checkpoint-seconds 60 \
    --max-wall-seconds 1800 \
    --ram-cap-mb 24576 \
    --cpu-cap-pct 50 \
    --io-cap-mb-s 50 \
    --temperature-cap-c 79 \
    --min-free-vram-mb 44000 \
    --seed 20260812
