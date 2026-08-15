# Referral adapter Prime run contract

This run continues the frozen `bitagent-bonsai8b-dagv2-lora-v3` PEFT adapter on
the `bonsai-referral-growth-v1` train split. It does not create a second adapter
stack or grant the model any runtime authority.

## Frozen inputs

- Base: `prism-ml/Bonsai-8B-unpacked`
- Base revision: `d916578504398e3d38753127e1fdeafb82ae4f0f`
- Source adapter weight SHA-256:
  `ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be`
- Train rows: 38; SHA-256:
  `49b01152c31935196d0c3aa8afe038041e4cdc4f0eb9dcbbc62e1d1222ac3563`
- Validation rows: 14; SHA-256:
  `f19ae314135e49797a911f14ea2dee4e61d95d507a9a1197df6d37426231f729`
- Held-out benchmark rows: 75 across 50 independent units; case SHA-256:
  `1301abf5e34c3d9155be71c92565e2cd63c7a264809f1d40b8ada62279f333c6`

The held-out benchmark is not copied to the pod until training has exited and
the resulting adapter SHA-256 has been written to the training receipt.

## Optimizer and compute contract

- one dedicated Prime spot pod; no reuse of unrelated pods
- one RTX 6000 Ada 48 GB GPU
- one role: `growth_referral_guide`
- maximum sequence length: 2,048 tokens
- per-device batch: 1
- gradient accumulation: 4
- epochs: 3
- learning rate: `5e-5`
- seed: `20260811`
- checkpoint every 5 optimizer steps or 60 seconds, retaining the latest 3
- training wall limit: 45 minutes
- whole pod lane target: 90 minutes, including setup, inference, and recovery
- host RSS admission/runtime limit: 24,576 MiB
- process CPU ceiling: 50 percent of pod capacity, with a five-sample grace
- process I/O ceiling: 50 MiB/s, with a three-sample grace
- GPU temperature admission and runtime ceiling: 79 C
- minimum free VRAM at admission: 44,000 MiB

Any sustained resource or thermal breach requests a checkpoint and clean stop.
The shell deadline is an independent final stop. The pod runner records JSONL
events, a training receipt, a cleanup receipt, and an exit receipt.

## Authority and isolation

The scripts contain no wallet, signer, seed, WIF, chain RPC, TradeLayer RPC, or
broadcast client. Model outputs remain candidates. Beneficiary selection,
binding changes, contact authorization, message sending, settlement, and
vesting remain host/human owned.

The baseline and candidate receive identical held-out prompts and deterministic
generation settings. Decoding stops after the first balanced JSON object, EOS,
or the shared 512-token cap; the first object is exactly the scorer input and
continuation padding is discarded for both candidates. The local TypeScript
benchmark remains the scoring source of truth. Passing deterministic checks is necessary but does not by itself
promote or publish the adapter; independent pairwise judgments and an operator
promotion decision remain separate gates.
