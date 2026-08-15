# Testnet Economic Agent

## Demo Boundary

`npm run demo:testnet-agent` runs a complete, non-custodial mock economic loop:

1. Invoke the real `tradelayer.js` BTC testnet4 VWAP planner with `--dry-run`.
2. Validate its TradeLayer transaction plans and preserve the generated artifact.
3. Evaluate a declared mock spread-capture scenario against compute and storage costs.
4. Prepare a Filecoin Calibration direct-deal object.
5. Prepare an Akash SDL deployment and a provider-neutral compute fallback.
6. Evaluate all infrastructure purchases with the financial survival policy.
7. Build non-relayable chain-abstraction envelopes for eventual NEAR Chain Signatures.
8. Publish wallet-readable activity and an append-only run directory.

The default run never signs, broadcasts, opens an Akash lease, or publishes a Filecoin deal. A dry-run trade has zero settled revenue and zero spendable profit even when its scenario projection has positive operating margin.

## Economic Model

The starter scenario uses 100,000 sats of hypothetical inventory across the sibling planner's 64,900 to 65,080 price range. It deducts a five-basis-point trading-fee assumption and the active mock Filecoin/Akash policy costs. The resulting coverage ratio answers one narrow question: would this declared spread have covered these declared infrastructure costs?

It does not establish fill probability, realized fees, token value, provider availability, or sustainable strategy alpha. Those require observed testnet transactions, reconciled balances, and repeated episodes.

## Runtime Artifacts

- `.runtime/testnet-agent/runs/<timestamp>/summary.json`
- `.runtime/testnet-agent/runs/<timestamp>/activities.jsonl`
- `.runtime/testnet-agent/runs/<timestamp>/tradelayer-testnet-vwap.json`
- `.runtime/testnet-agent/latest/summary.json`
- `.runtime/testnet-agent/latest/activities.jsonl`
- `.runtime/testnet-agent/latest/tradelayer-testnet-vwap.json`

Set `FILECOIN_PROBE=true` to add a read-only Calibration `Filecoin.ChainHead` health probe. No credential is sent by that probe.

## Path To Live Testnet

1. Put Bitcoin testnet4 custody in an external broker that validates the exact TradeLayer plan, signs, broadcasts, and returns txids.
2. Add a TradeLayer settlement observer that confirms both sides of each trade and reconciles actual PnL.
3. Replace Filecoin mock CID metadata with CAR generation, CommP verification, provider discovery, and a Calibration deal publisher.
4. Add an Akash client broker for certificate handling, bids, leases, manifest delivery, provider status, and payment reconciliation.
5. Encode exact Filecoin/Akash transaction bytes before requesting a NEAR Chain Signature; reject any payload whose hash differs from the approved intent.
6. Promote profit to treasury only after independent chain observers satisfy quorum and confirmation policy.
7. Run repeated seeded mock/testnet episodes with downtime, price, fee, and provider-failure ablations before enabling any mainnet value.

