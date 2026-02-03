# Safe Multisig Automation (2-of-3)

Fully automated multisig transaction signing using Safe Protocol SDK. All 2-of-3 signatures are collected programmatically - no manual UI interaction needed.

## Features

- ✅ Deploy new Safe or connect to existing
- ✅ Automated 2-of-3 signing via private keys
- ✅ Batch transactions (MultiSend)
- ✅ Automation examples
- ✅ Multi-chain support
- ✅ Bridge integration examples (Across Protocol)

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your private keys

# Run
npm start
```

## Usage

### Basic Transaction

```typescript
import { SafeMultisigManager } from './safe-multisig'

const config = {
  rpcUrl: 'https://rpc.ankr.com/eth',
  chainId: 1n,
  safeAddress: '0x...', // Omit to deploy new Safe
  threshold: 2,
  signers: [
    { privateKey: '0x...', address: '0x...' },
    { privateKey: '0x...', address: '0x...' },
    { privateKey: '0x...', address: '0x...' }
  ]
}

const manager = new SafeMultisigManager(config)
await manager.initialize()

// Execute with automated 2-of-3 signing
await manager.executeTransaction(
  '0xRecipient',
  ethers.parseEther('1.0').toString(),
  '0x'
)
```

### Batch Transactions

```typescript
await manager.executeBatchTransaction([
  { to: token, value: '0', data: approveData, operation: 0 },
  { to: router, value: '0', data: swapData, operation: 0 }
])
```

### Contract Calls

```typescript
const data = manager.encodeContractCall(
  ['function transfer(address,uint256)'],
  'transfer',
  [recipient, amount]
)
await manager.executeTransaction(tokenAddress, '0', data)
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Script                          │
├─────────────────────────────────────────────────────────┤
│                SafeMultisigManager                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │ProtocolKit 1 │ │ProtocolKit 2 │ │ProtocolKit 3 │    │
│  │  (Signer 1)  │ │  (Signer 2)  │ │  (Signer 3)  │    │
│  └──────────────┘ └──────────────┘ └──────────────┘    │
├─────────────────────────────────────────────────────────┤
│                   Safe Contract                         │
│              (2-of-3 Threshold)                         │
└─────────────────────────────────────────────────────────┘
```

## Signing Flow

1. **Create Transaction** - First signer creates SafeTransaction
2. **Collect Signatures** - Each signer signs off-chain (no gas)
3. **Execute** - Last signer submits to chain with all signatures

```typescript
// This happens automatically in executeTransaction():
let tx = await protocolKit1.createTransaction({ ... })
tx = await protocolKit1.signTransaction(tx)  // Sig 1
tx = await protocolKit2.signTransaction(tx)  // Sig 2
await protocolKit2.executeTransaction(tx)    // Execute
```

## Multi-Chain DCA Example

```typescript
const orchestrator = new MultiChainDCAOrchestrator()
await orchestrator.initialize(chains, signers, 2)

// Execute same DCA strategy on all chains
await orchestrator.executeOnAllChains(async (manager, chainId) => {
  return runDCASwap(manager, dcaConfig)
})
```

## Supported Networks

Safe Transaction Service is available on:

| Network | Chain ID |
|---------|----------|
| Ethereum | 1 |
| Arbitrum | 42161 |
| Optimism | 10 |
| Base | 8453 |
| Polygon | 137 |
| Avalanche | 43114 |
| BNB Chain | 56 |
| Gnosis | 100 |

For custom networks, provide `txServiceUrl`:

```typescript
const apiKit = new SafeApiKit({
  chainId: 1234n,
  txServiceUrl: 'https://your-safe-service.com'
})
```

## Security Notes

⚠️ **Private Key Management**
- Store private keys securely (HSM, KMS, or encrypted vaults)
- Never commit private keys to git
- Use separate keys for each signer
- Consider hardware wallet integration for production

⚠️ **Operational Security**
- Monitor Safe transactions
- Set up alerts for unexpected activity
- Use separate Safe per use case
- Regular key rotation

## Async Flow (Optional)

For cases where signers aren't available simultaneously:

```typescript
// Signer 1 proposes
const safeTxHash = await manager.proposeTransaction(to, value, data, signer1)

// Signer 2 confirms later
await manager.confirmTransaction(safeTxHash, signer2)

// Anyone executes when threshold met
await manager.executePendingTransaction(safeTxHash, executor)
```

## License

MIT
