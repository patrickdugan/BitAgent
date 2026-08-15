#!/usr/bin/env bash
set -euo pipefail

workspace="${BITAGENT_POD_WORKSPACE:-/home/ubuntu/bitagent-referral-growth-v1}"
cd "$workspace"
test ! -e cases.jsonl
test ! -e run.pid
chmod 700 run_train.sh
nohup ./run_train.sh > train.log 2>&1 &
run_pid=$!
printf '%s\n' "$run_pid" > run.pid
printf '%s\n' "$run_pid"
