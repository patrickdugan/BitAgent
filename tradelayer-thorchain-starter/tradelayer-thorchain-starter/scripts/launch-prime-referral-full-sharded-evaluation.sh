#!/usr/bin/env bash
set -euo pipefail

workspace="${BITAGENT_POD_WORKSPACE:-/home/ubuntu/bitagent-referral-eval-recovery}"
cd "$workspace"
test ! -e run.pid
chmod 700 run_eval.sh
nohup ./run_eval.sh > eval.log 2>&1 &
run_pid=$!
printf '%s\n' "$run_pid" > run.pid
printf '%s\n' "$run_pid"
