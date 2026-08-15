---
license: apache-2.0
base_model: prism-ml/Bonsai-8B-unpacked
library_name: llama.cpp
tags:
  - gguf
  - lora
  - adapter
  - bitagent
  - candidate-only
---

# BitAgent Bonsai-8B DAG v3 LoRA

This repository distributes the GGUF LoRA artifact selected by BitAgent's
versioned local runtime manifest. It is intentionally separate from the base
model so mobile applications can fetch the Apache-2.0 Bonsai base from its
authoritative Prism ML repository.

## Artifact

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `bitagent-bonsai8b-dagv2-lora-v3-f16.gguf` | 87,329,024 | `9a11fe2cecf795f53dbea490b9897b28f3d3346a9f69a71ce28bbb195f7de704` |

Source adapter SHA-256:
`ceb39699033124710f2537d1e65d3cb794f43f9e7c3313b3c93522da7df913be`.

The tested base artifact is
`prism-ml/Bonsai-8B-gguf/Bonsai-8B-Q1_0.gguf` at revision
`48516770dd04643643e9f9019a2a349cf26c5dbd`, SHA-256
`284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54`.

## Authority and readiness

This adapter produces candidates only. It has no authority to approve, sign,
execute, broadcast, access secrets, or alter wallet permissions. Every proposed
financial action must pass deterministic host validation and simulation, exact
wallet display, and human wallet approval.

The source BitAgent runtime manifest currently marks this package
`adapter_packaged_gpu_screening_required` with `operatorReady: false`. Publishing
or downloading the file does not promote it for live operation. Consumers must
pin the exact revision, byte length, and SHA-256 and must not accept model- or
prompt-selected artifact URLs.

## Mobile distribution

The Android application does not bundle this file. A user may explicitly
download it to app-private, no-backup storage after a local capacity check. The
application verifies length and SHA-256 before making the artifact available and
does not place Hugging Face credentials in the APK.
