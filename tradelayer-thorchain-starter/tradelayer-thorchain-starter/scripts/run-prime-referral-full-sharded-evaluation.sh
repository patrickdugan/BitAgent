#!/usr/bin/env bash
set -euo pipefail

workspace="${BITAGENT_POD_WORKSPACE:-/home/ubuntu/bitagent-referral-eval-recovery}"
python_bin="${BITAGENT_POD_PYTHON:-python3}"
eval_dir="$workspace/eval"

write_exit_receipt() {
  exit_code=$?
  set +e
  "$python_bin" - "$eval_dir" "$exit_code" <<'PY'
import datetime
import json
import pathlib
import sys

output = pathlib.Path(sys.argv[1])
exit_code = int(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
(output / "full_sharded_evaluation_exit_receipt.json").write_text(
    json.dumps({
        "schema": "bitagent.referral_full_sharded_evaluation_exit.v1",
        "status": "completed" if exit_code == 0 else "aborted_or_failed",
        "exit_code": exit_code,
        "wallet_or_chain_access": False,
        "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, indent=2) + "\n",
    encoding="utf-8",
)
PY
  exit "$exit_code"
}
trap write_exit_receipt EXIT

test -f "$workspace/cases.jsonl"
test "$(sha256sum "$workspace/cases.jsonl" | cut -d' ' -f1)" = "1301abf5e34c3d9155be71c92565e2cd63c7a264809f1d40b8ada62279f333c6"
test "$(sha256sum "$workspace/baseline-adapter/adapter_model.safetensors" | cut -d' ' -f1)" = "ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be"
test "$(sha256sum "$workspace/candidate-adapter/adapter_model.safetensors" | cut -d' ' -f1)" = "ccee15e8df9b3b72a3c5daa90d3b6bfc702daab1325054ca009963656a9e6c90"
install -d -m 700 "$eval_dir"

"$python_bin" -m pip install --user --no-cache-dir --disable-pip-version-check \
  torch==2.7.1 \
  --index-url https://download.pytorch.org/whl/cu126
"$python_bin" -m pip install --user --disable-pip-version-check -r "$workspace/requirements.txt"
"$python_bin" - <<'PY'
import json
import subprocess
import torch

if not torch.cuda.is_available():
    raise SystemExit("CUDA unavailable")
properties = torch.cuda.get_device_properties(0)
temperature = int(subprocess.check_output([
    "nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits", "-i", "0"
], text=True).strip())
if properties.total_memory < 44 * 1024**3:
    raise SystemExit(f"GPU has only {properties.total_memory / 1024**3:.1f} GiB")
if temperature > 79:
    raise SystemExit(f"GPU temperature at admission is {temperature} C")
print(json.dumps({
    "torch": torch.__version__,
    "cuda": torch.version.cuda,
    "gpu": properties.name,
    "memory_gib": round(properties.total_memory / 1024**3, 1),
    "temperature_c": temperature,
}))
PY

"$python_bin" - <<'PY'
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="prism-ml/Bonsai-8B-unpacked",
    revision="d916578504398e3d38753127e1fdeafb82ae4f0f",
)
PY

: > "$eval_dir/empty-prefix.jsonl"
for candidate in baseline_v3 referral_growth_v1; do
  if [ "$candidate" = "baseline_v3" ]; then
    adapter="$workspace/baseline-adapter"
    adapter_sha="ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be"
  else
    adapter="$workspace/candidate-adapter"
    adapter_sha="ccee15e8df9b3b72a3c5daa90d3b6bfc702daab1325054ca009963656a9e6c90"
  fi
  shard_dir="$eval_dir/$candidate-shards"
  install -d -m 700 "$shard_dir"
  pids=()
  for shard_index in 0 1 2 3; do
    timeout --signal=TERM --kill-after=60s 1200s \
      "$python_bin" "$workspace/infer-referral-growth-benchmark.py" \
        --cases "$workspace/cases.jsonl" \
        --adapter "$adapter" \
        --candidate "$candidate" \
        --output "$shard_dir/shard-$shard_index.predictions.jsonl" \
        --expected-adapter-sha256 "$adapter_sha" \
        --max-new-tokens 512 \
        --seed 20260811 \
        --start-index 0 \
        --shard-index "$shard_index" \
        --shard-count 4 \
        > "$shard_dir/shard-$shard_index.log" 2>&1 &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done
  "$python_bin" "$workspace/combine-referral-benchmark-predictions.py" \
    --cases "$workspace/cases.jsonl" \
    --candidate "$candidate" \
    --prefix "$eval_dir/empty-prefix.jsonl" \
    --shard "$shard_dir/shard-0.predictions.jsonl" \
    --shard "$shard_dir/shard-1.predictions.jsonl" \
    --shard "$shard_dir/shard-2.predictions.jsonl" \
    --shard "$shard_dir/shard-3.predictions.jsonl" \
    --output "$eval_dir/$candidate.predictions.jsonl"
done
