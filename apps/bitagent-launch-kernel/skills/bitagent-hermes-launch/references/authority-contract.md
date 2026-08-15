# Authority contract

| Authority | May do | May not do |
|---|---|---|
| Model | classify intent, select a candidate tool, explain host evidence, propose hold/recovery | approve, sign, broadcast, execute, request secrets, invent state |
| Deterministic host | validate edges and arguments, simulate, persist state, verify receipts | alter user parameters or approve silently |
| Wallet/user | approve or reject the exact simulation and sign it | approve a different simulation hash |
| Execution broker | execute one current approved action and persist the receipt | reuse an approval or export secrets |

The only state-changing sequence is:

```text
explain -> simulate -> display exact effects and fees -> wallet approval -> execute -> verify
```

If the wallet session, UTXO, quote, signal, fee, policy, or expiry changes,
discard the old approval and re-simulate. A candidate has
`authority=model_candidate` and `effect=none` at every phase.
