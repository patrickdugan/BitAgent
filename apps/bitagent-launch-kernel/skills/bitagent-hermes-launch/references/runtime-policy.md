# Bonsai and testnet runtime policy

- The Bonsai candidate is unselected until a deterministic registration and
  evaluation gate passes. A model result is never execution authority.
- Local RTX 3050 work starts and remains at or below 79 C. Require three
  admission samples at or below 71 C, use a proactive 75 C cutoff, and persist
  cleanup and thermal receipts.
- In the true inclusive 12k mode reserve 2400 fixed, 2000 schemas, 4000 packet,
  1500 tool results, 1024 output, and 1076 safety tokens.
- Bitcoin testnet4 work may read public observations and prepare a wallet-owned
  candidate. It may not access private keys, seed phrases, raw PSBTs, or sign
  and broadcast through the model.
- On interrupted session, rejected signature, stale quote, malformed address,
  or unconfirmed deposit, persist recovery state and require new host evidence.
