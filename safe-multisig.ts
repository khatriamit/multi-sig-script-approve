import Safe from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { SafeFactory } from '@safe-global/protocol-kit'
import { 
  SafeTransactionDataPartial,
  MetaTransactionData,
  OperationType 
} from '@safe-global/safe-core-sdk-types'
import { ethers } from 'ethers'

// ============================================================================
// CONFIGURATION
// ============================================================================

interface SignerConfig {
  privateKey: string
  address: string
}

interface SafeConfig {
  rpcUrl: string
  chainId: bigint
  safeAddress?: string  // Optional - if not provided, will deploy new Safe
  threshold: number
  signers: SignerConfig[]
  /** Optional. Required for chains without built-in Safe transaction service (e.g. Polygon Amoy 80002). */
  txServiceUrl?: string
}

// ============================================================================
// SAFE MULTISIG MANAGER
// ============================================================================

export class SafeMultisigManager {
  private config: SafeConfig
  private apiKit: SafeApiKit
  private protocolKits: Map<string, Safe> = new Map()
  private provider: ethers.JsonRpcProvider

  constructor(config: SafeConfig) {
    this.config = config
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl)
    
    this.apiKit = new SafeApiKit({
      chainId: config.chainId,
      ...(config.txServiceUrl && { txServiceUrl: config.txServiceUrl })
    })
  }

  // Initialize Protocol Kit instances for each signer
  async initialize(): Promise<string> {
    let safeAddress = this.config.safeAddress

    // Deploy new Safe if address not provided
    if (!safeAddress) {
      safeAddress = await this.deploySafe()
    }

    // Create Protocol Kit instance for each signer
    for (const signer of this.config.signers) {
      const protocolKit = await Safe.init({
        provider: this.config.rpcUrl,
        signer: signer.privateKey,
        safeAddress
      })
      this.protocolKits.set(signer.address.toLowerCase(), protocolKit)
    }

    console.log(`✅ Initialized Safe: ${safeAddress}`)
    console.log(`   Threshold: ${this.config.threshold} of ${this.config.signers.length}`)
    
    return safeAddress
  }

  // Deploy a new Safe with configured owners
  private async deploySafe(): Promise<string> {
    const firstSigner = this.config.signers[0]
    
    const safeFactory = await SafeFactory.init({
      provider: this.config.rpcUrl,
      signer: firstSigner.privateKey
    })

    const safeAccountConfig = {
      owners: this.config.signers.map(s => s.address),
      threshold: this.config.threshold
    }

    console.log('🚀 Deploying new Safe...')
    const protocolKit = await safeFactory.deploySafe({ safeAccountConfig })
    const safeAddress = await protocolKit.getAddress()
    
    console.log(`✅ Safe deployed at: ${safeAddress}`)
    return safeAddress
  }

  // Get Protocol Kit for a specific signer
  private getProtocolKit(signerAddress: string): Safe {
    const kit = this.protocolKits.get(signerAddress.toLowerCase())
    if (!kit) {
      throw new Error(`No Protocol Kit found for signer: ${signerAddress}`)
    }
    return kit
  }

  // ============================================================================
  // TRANSACTION CREATION & EXECUTION
  // ============================================================================

  /**
   * Create, sign with all required signers, and execute a transaction
   * Full automation - no manual intervention needed
   */
  async executeTransaction(
    to: string,
    value: string,
    data: string = '0x',
    signerAddresses?: string[]  // Which signers to use (defaults to first N meeting threshold)
  ): Promise<string> {
    const signersToUse = signerAddresses || 
      this.config.signers.slice(0, this.config.threshold).map(s => s.address)
    
    if (signersToUse.length < this.config.threshold) {
      throw new Error(`Need at least ${this.config.threshold} signers, got ${signersToUse.length}`)
    }

    // Use first signer to create transaction
    const primaryKit = this.getProtocolKit(signersToUse[0])
    
    const safeTransactionData: SafeTransactionDataPartial = {
      to,
      value,
      data,
      operation: OperationType.Call
    }

    console.log('\n📝 Creating transaction...')
    let safeTransaction = await primaryKit.createTransaction({
      transactions: [safeTransactionData]
    })

    // Sign with each required signer
    for (let i = 0; i < signersToUse.length; i++) {
      const signerAddress = signersToUse[i]
      const kit = this.getProtocolKit(signerAddress)
      
      console.log(`✍️  Signing with owner ${i + 1}/${signersToUse.length}: ${signerAddress}`)
      safeTransaction = await kit.signTransaction(safeTransaction)
    }

    console.log(`\n📤 Executing transaction (${safeTransaction.signatures.size} signatures)...`)
    
    // Execute with the last signer
    const executorKit = this.getProtocolKit(signersToUse[signersToUse.length - 1])
    const executeTxResponse = await executorKit.executeTransaction(safeTransaction)
    const txResponse = executeTxResponse.transactionResponse as { wait(): Promise<{ hash: string }> } | null | undefined
    const receipt = txResponse ? await txResponse.wait() : null
    const txHash = receipt?.hash ?? (executeTxResponse as { hash?: string }).hash

    console.log(`✅ Transaction executed: ${txHash}`)
    return txHash ?? ''
  }

  /**
   * Execute multiple transactions in a batch (MultiSend)
   */
  async executeBatchTransaction(
    transactions: MetaTransactionData[],
    signerAddresses?: string[]
  ): Promise<string> {
    const signersToUse = signerAddresses || 
      this.config.signers.slice(0, this.config.threshold).map(s => s.address)

    const primaryKit = this.getProtocolKit(signersToUse[0])

    console.log(`\n📝 Creating batch transaction (${transactions.length} operations)...`)
    let safeTransaction = await primaryKit.createTransaction({
      transactions
    })

    // Sign with each required signer
    for (let i = 0; i < signersToUse.length; i++) {
      const signerAddress = signersToUse[i]
      const kit = this.getProtocolKit(signerAddress)
      
      console.log(`✍️  Signing batch with owner ${i + 1}/${signersToUse.length}: ${signerAddress}`)
      safeTransaction = await kit.signTransaction(safeTransaction)
    }

    console.log(`\n📤 Executing batch transaction...`)
    const executorKit = this.getProtocolKit(signersToUse[signersToUse.length - 1])
    const executeTxResponse = await executorKit.executeTransaction(safeTransaction)
    const txResponse = executeTxResponse.transactionResponse as { wait(): Promise<{ hash: string }> } | null | undefined
    const receipt = txResponse ? await txResponse.wait() : null
    const txHash = receipt?.hash ?? (executeTxResponse as { hash?: string }).hash

    console.log(`✅ Batch transaction executed: ${txHash}`)
    return txHash ?? ''
  }

  // ============================================================================
  // ASYNC FLOW (Propose -> Collect Signatures -> Execute)
  // For cases where signers aren't all available at once
  // ============================================================================

  /**
   * Propose a transaction to the Safe Transaction Service
   * Other signers can then confirm it via UI or script
   */
  async proposeTransaction(
    to: string,
    value: string,
    data: string = '0x',
    proposerAddress: string
  ): Promise<string> {
    const kit = this.getProtocolKit(proposerAddress)
    const safeAddress = await kit.getAddress()

    const safeTransactionData: SafeTransactionDataPartial = {
      to,
      value,
      data,
      operation: OperationType.Call
    }

    const safeTransaction = await kit.createTransaction({
      transactions: [safeTransactionData]
    })

    const safeTxHash = await kit.getTransactionHash(safeTransaction)
    const signature = await kit.signHash(safeTxHash)

    console.log('\n📤 Proposing transaction to Safe Service...')
    await this.apiKit.proposeTransaction({
      safeAddress,
      safeTransactionData: safeTransaction.data,
      safeTxHash,
      senderAddress: proposerAddress,
      senderSignature: signature.data
    })

    console.log(`✅ Transaction proposed: ${safeTxHash}`)
    return safeTxHash
  }

  /**
   * Confirm a pending transaction
   */
  async confirmTransaction(safeTxHash: string, signerAddress: string): Promise<void> {
    const kit = this.getProtocolKit(signerAddress)
    
    console.log(`\n✍️  Confirming transaction: ${safeTxHash}`)
    const signature = await kit.signHash(safeTxHash)
    
    await this.apiKit.confirmTransaction(safeTxHash, signature.data)
    console.log(`✅ Transaction confirmed by: ${signerAddress}`)
  }

  /**
   * Get pending transactions
   */
  async getPendingTransactions(): Promise<any[]> {
    const safeAddress = await this.getProtocolKit(this.config.signers[0].address).getAddress()
    const pendingTxs = await this.apiKit.getPendingTransactions(safeAddress)
    return pendingTxs.results
  }

  /**
   * Execute a pending transaction that has enough signatures
   */
  async executePendingTransaction(safeTxHash: string, executorAddress: string): Promise<string> {
    const kit = this.getProtocolKit(executorAddress)
    
    console.log(`\n📤 Fetching transaction: ${safeTxHash}`)
    const safeTransaction = await this.apiKit.getTransaction(safeTxHash)
    
    console.log(`   Confirmations: ${safeTransaction.confirmations?.length || 0}/${this.config.threshold}`)
    
    if ((safeTransaction.confirmations?.length || 0) < this.config.threshold) {
      throw new Error(`Not enough confirmations. Need ${this.config.threshold}, have ${safeTransaction.confirmations?.length || 0}`)
    }

    console.log('📤 Executing transaction...')
    const executeTxResponse = await kit.executeTransaction(safeTransaction as Parameters<typeof kit.executeTransaction>[0])
    const txResponse = executeTxResponse.transactionResponse as { wait(): Promise<{ hash: string }> } | null | undefined
    const receipt = txResponse ? await txResponse.wait() : null
    const txHash = receipt?.hash ?? (executeTxResponse as { hash?: string }).hash

    console.log(`✅ Transaction executed: ${txHash}`)
    return txHash ?? ''
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  async getSafeInfo(): Promise<{
    address: string
    threshold: number
    owners: string[]
    nonce: number
    balance: string
  }> {
    const kit = this.getProtocolKit(this.config.signers[0].address)
    const address = await kit.getAddress()
    const threshold = await kit.getThreshold()
    const owners = await kit.getOwners()
    const nonce = await kit.getNonce()
    const balance = await this.provider.getBalance(address)

    return {
      address,
      threshold,
      owners,
      nonce,
      balance: ethers.formatEther(balance)
    }
  }

  /**
   * Encode contract call data
   */
  encodeContractCall(
    abi: any[],
    functionName: string,
    args: any[]
  ): string {
    const iface = new ethers.Interface(abi)
    return iface.encodeFunctionData(functionName, args)
  }
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

async function main() {
  // Example configuration - replace with your actual values
  const config: SafeConfig = {
    rpcUrl: process.env.RPC_URL || 'https://rpc.ankr.com/eth_sepolia',
    chainId: BigInt(process.env.CHAIN_ID || 11155111),  // Sepolia
    safeAddress: process.env.SAFE_ADDRESS,  // Optional - omit to deploy new Safe
    threshold: 2,
    signers: [
      {
        privateKey: process.env.SIGNER_1_PRIVATE_KEY!,
        address: process.env.SIGNER_1_ADDRESS!
      },
      {
        privateKey: process.env.SIGNER_2_PRIVATE_KEY!,
        address: process.env.SIGNER_2_ADDRESS!
      },
      {
        privateKey: process.env.SIGNER_3_PRIVATE_KEY!,
        address: process.env.SIGNER_3_ADDRESS!
      }
    ]
  }

  const manager = new SafeMultisigManager(config)
  await manager.initialize()

  // Get Safe info
  const info = await manager.getSafeInfo()
  console.log('\n📊 Safe Info:', info)

  // Example 1: Simple ETH transfer
  // await manager.executeTransaction(
  //   '0xRecipientAddress',
  //   ethers.parseEther('0.01').toString(),
  //   '0x'
  // )

  // Example 2: Contract interaction
  // const erc20Abi = ['function transfer(address to, uint256 amount)']
  // const data = manager.encodeContractCall(
  //   erc20Abi,
  //   'transfer',
  //   ['0xRecipient', ethers.parseUnits('100', 18)]
  // )
  // await manager.executeTransaction(tokenAddress, '0', data)

  // Example 3: Batch transactions
  // await manager.executeBatchTransaction([
  //   { to: addr1, value: '1000000000000000', data: '0x', operation: OperationType.Call },
  //   { to: addr2, value: '2000000000000000', data: '0x', operation: OperationType.Call },
  // ])
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error)
}

export { SafeConfig, SignerConfig }
