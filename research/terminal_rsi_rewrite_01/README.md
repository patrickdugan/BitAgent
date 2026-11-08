# TRSI-REWRITE-01 and TRSI-QUANT-01

Prepared 2026-11-09 for patrickdugan/BitAgent.

Status: finite selection/coupling arithmetic executed. Native Bonsai/Hermes trajectory rewriting and quantization experiments remain unrun.

The inspected root README places models behind the launch kernel's deterministic host and a wallet-owned broker, with `fundedExecutionAllowed=false`. This work preserves that boundary. It owns research measurements and candidate-only replay designs, with GDK as the first integration surface and Hermes as a later runtime comparison.

```bash
cd research/terminal_rsi_rewrite_01
python -m unittest discover -s . -p 'test_*.py' -v
python run_cpu.py
```

There are no wallet calls, transactions, node connections, model downloads or external imports.
