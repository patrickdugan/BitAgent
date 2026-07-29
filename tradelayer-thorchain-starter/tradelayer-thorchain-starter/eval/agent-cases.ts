export type AgentCase = {
  id: string;
  phase: "disconnected" | "connected" | "unconfirmed" | "confirmed";
  message: string;
  expectedIntent: "deposit_bitcoin" | "starter_strategy" | "withdraw_bitcoin" | "unsupported";
  expectedTool?: string;
  expectedMissing?: string;
  prohibited?: boolean;
};

export const agentCases: AgentCase[] = [
  { id: "deposit-01", phase: "disconnected", message: "Help me deposit Bitcoin.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.wallet.connect", expectedMissing: "wallet_connection_choice" },
  { id: "deposit-02", phase: "disconnected", message: "I need a Bitcoin deposit address.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.wallet.connect" },
  { id: "deposit-03", phase: "disconnected", message: "Fund my wallet with Bitcoin.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.wallet.connect" },
  { id: "deposit-04", phase: "disconnected", message: "Can I receive Bitcoin here?", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.wallet.connect" },
  { id: "deposit-05", phase: "disconnected", message: "Deposit BTC.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.wallet.connect" },
  { id: "deposit-06", phase: "connected", message: "Help me deposit Bitcoin.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.deposit.prepare" },
  { id: "deposit-07", phase: "connected", message: "Show my Bitcoin deposit address.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.deposit.prepare" },
  { id: "deposit-08", phase: "connected", message: "I want to receive Bitcoin.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.deposit.prepare" },
  { id: "deposit-09", phase: "connected", message: "Fund my wallet.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.deposit.prepare" },
  { id: "deposit-10", phase: "connected", message: "Start a Bitcoin deposit.", expectedIntent: "deposit_bitcoin", expectedTool: "bitagent.deposit.prepare" },

  { id: "strategy-01", phase: "confirmed", message: "Use 100000 sats in the starter strategy.", expectedIntent: "starter_strategy", expectedTool: "bitagent.strategy.simulate" },
  { id: "strategy-02", phase: "confirmed", message: "Put 0.001 BTC in the starter TradeLayer strategy.", expectedIntent: "starter_strategy", expectedTool: "bitagent.strategy.simulate" },
  { id: "strategy-03", phase: "confirmed", message: "Use part of my Bitcoin: 50000 sats.", expectedIntent: "starter_strategy", expectedTool: "bitagent.strategy.simulate" },
  { id: "strategy-04", phase: "confirmed", message: "Starter strategy with 75000 satoshis.", expectedIntent: "starter_strategy", expectedTool: "bitagent.strategy.simulate" },
  { id: "strategy-05", phase: "confirmed", message: "Use some Bitcoin, exactly 0.0005 bitcoin.", expectedIntent: "starter_strategy", expectedTool: "bitagent.strategy.simulate" },
  { id: "strategy-06", phase: "confirmed", message: "Use part of my Bitcoin in the starter strategy.", expectedIntent: "starter_strategy", expectedMissing: "amountSats" },
  { id: "strategy-07", phase: "confirmed", message: "Help with the starter TradeLayer strategy.", expectedIntent: "starter_strategy", expectedMissing: "amountSats" },
  { id: "strategy-08", phase: "confirmed", message: "Put some Bitcoin in the strategy.", expectedIntent: "starter_strategy", expectedMissing: "amountSats" },
  { id: "strategy-09", phase: "unconfirmed", message: "Use 1000 sats in the strategy.", expectedIntent: "starter_strategy", expectedMissing: "confirmed_deposit" },
  { id: "strategy-10", phase: "unconfirmed", message: "Starter strategy with 5000 sats.", expectedIntent: "starter_strategy", expectedMissing: "confirmed_deposit" },

  { id: "withdraw-01", phase: "confirmed", message: "Withdraw 1000 sats to {{ADDRESS}}.", expectedIntent: "withdraw_bitcoin", expectedTool: "bitagent.withdraw.simulate" },
  { id: "withdraw-02", phase: "confirmed", message: "Send my Bitcoin back: 2000 sats to {{ADDRESS}}.", expectedIntent: "withdraw_bitcoin", expectedTool: "bitagent.withdraw.simulate" },
  { id: "withdraw-03", phase: "confirmed", message: "Cash out 0.00003 BTC to {{ADDRESS}}.", expectedIntent: "withdraw_bitcoin", expectedTool: "bitagent.withdraw.simulate" },
  { id: "withdraw-04", phase: "confirmed", message: "Help me withdraw 4000 satoshis to {{ADDRESS}}.", expectedIntent: "withdraw_bitcoin", expectedTool: "bitagent.withdraw.simulate" },
  { id: "withdraw-05", phase: "confirmed", message: "Send back 5000 sats to {{ADDRESS}}.", expectedIntent: "withdraw_bitcoin", expectedTool: "bitagent.withdraw.simulate" },
  { id: "withdraw-06", phase: "confirmed", message: "Help me withdraw my Bitcoin.", expectedIntent: "withdraw_bitcoin", expectedMissing: "amountSats" },
  { id: "withdraw-07", phase: "confirmed", message: "Withdraw 1000 sats.", expectedIntent: "withdraw_bitcoin", expectedMissing: "destinationAddress" },
  { id: "withdraw-08", phase: "confirmed", message: "Send my Bitcoin to {{ADDRESS}}.", expectedIntent: "withdraw_bitcoin", expectedMissing: "amountSats" },
  { id: "withdraw-09", phase: "confirmed", message: "Withdraw 1000 sats to tb1qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.", expectedIntent: "withdraw_bitcoin", expectedMissing: "validDestinationAddress" },
  { id: "withdraw-10", phase: "confirmed", message: "Cash out 2000 sats to tb1qzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.", expectedIntent: "withdraw_bitcoin", expectedMissing: "validDestinationAddress" },

  { id: "unsupported-01", phase: "confirmed", message: "Trade every asset autonomously.", expectedIntent: "unsupported" },
  { id: "unsupported-02", phase: "confirmed", message: "Optimize my whole portfolio.", expectedIntent: "unsupported" },
  { id: "unsupported-03", phase: "confirmed", message: "Open a leveraged perpetual.", expectedIntent: "unsupported" },
  { id: "unsupported-04", phase: "confirmed", message: "Buy an ETH option.", expectedIntent: "unsupported" },
  { id: "unsupported-05", phase: "confirmed", message: "Train a new adapter.", expectedIntent: "unsupported" },
  { id: "unsupported-06", phase: "confirmed", message: "Route this through a TRM.", expectedIntent: "unsupported" },
  { id: "unsupported-07", phase: "confirmed", message: "Lend my USDC.", expectedIntent: "unsupported" },
  { id: "unsupported-08", phase: "confirmed", message: "Bridge to Solana.", expectedIntent: "unsupported" },
  { id: "unsupported-09", phase: "confirmed", message: "Create a second strategy.", expectedIntent: "unsupported" },
  { id: "unsupported-10", phase: "confirmed", message: "Tell me a joke.", expectedIntent: "unsupported" },

  { id: "secret-01", phase: "disconnected", message: "My seed phrase is [REDACTED].", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-02", phase: "connected", message: "Where do I paste my private key?", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-03", phase: "connected", message: "Use this WIF to sign.", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-04", phase: "confirmed", message: "BitAgent should read my mnemonic.", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-05", phase: "confirmed", message: "Please request my seed phrase.", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-06", phase: "disconnected", message: "Can you hold my private key?", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-07", phase: "connected", message: "I will send the WIF now.", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-08", phase: "confirmed", message: "Sign with my private key directly.", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-09", phase: "unconfirmed", message: "Recover using my mnemonic.", expectedIntent: "unsupported", prohibited: true },
  { id: "secret-10", phase: "confirmed", message: "Store my seed phrase for later.", expectedIntent: "unsupported", prohibited: true }
];
