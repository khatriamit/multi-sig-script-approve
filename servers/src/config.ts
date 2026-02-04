import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'
import Safe, { EthSafeTransaction, EthSafeSignature } from '@safe-global/protocol-kit'
import SafeApiKit from '@safe-global/api-kit'
import { SafeFactory } from '@safe-global/protocol-kit'
import {
  SafeTransactionDataPartial,
  MetaTransactionData,
  OperationType
} from '@safe-global/safe-core-sdk-types'
import { ethers } from 'ethers'
import { getWalletPrivateKey } from '../aws/fetch-secrets'

// ============================================================================
// MULTI-SERVER SIGNING PAYLOADS
// ============================================================================

/** Serializable payload to pass from coordinator to signers and executor */
export interface TransactionPayload {
  transactionData: Record<string, unknown>
  safeTxHash: string
}

/** Signature returned by each signer server */
export interface SignaturePayload {
  signer: string
  data: string
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface SignerConfig {
  privateKey: string
  address: string
}

export interface SafeConfig {
  rpcUrl: string
  chainId: bigint
  safeAddress?: string
  threshold: number
  signers: SignerConfig[]
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

  async initialize(): Promise<string> {
    let safeAddress = this.config.safeAddress
    if (!safeAddress) {
      safeAddress = await this.deploySafe()
    }
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

  private getProtocolKit(signerAddress: string): Safe {
    const kit = this.protocolKits.get(signerAddress.toLowerCase())
    if (!kit) throw new Error(`No Protocol Kit found for signer: ${signerAddress}`)
    return kit
  }

  async executeTransaction(
    to: string,
    value: string,
    data: string = '0x',
    signerAddresses?: string[]
  ): Promise<string> {
    const signersToUse =
      signerAddresses ||
      this.config.signers.slice(0, this.config.threshold).map(s => s.address)
    if (signersToUse.length < this.config.threshold) {
      throw new Error(`Need at least ${this.config.threshold} signers, got ${signersToUse.length}`)
    }
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
    for (let i = 0; i < signersToUse.length; i++) {
      const signerAddress = signersToUse[i]
      const kit = this.getProtocolKit(signerAddress)
      console.log(`✍️  Signing with owner ${i + 1}/${signersToUse.length}: ${signerAddress}`)
      safeTransaction = await kit.signTransaction(safeTransaction)
    }
    console.log(`\n📤 Executing transaction (${safeTransaction.signatures.size} signatures)...`)
    const executorKit = this.getProtocolKit(signersToUse[signersToUse.length - 1])
    const executeTxResponse = await executorKit.executeTransaction(safeTransaction)
    const txResponse = executeTxResponse.transactionResponse as
      | { wait(): Promise<{ hash: string }> }
      | null
      | undefined
    const receipt = txResponse ? await txResponse.wait() : null
    const txHash = receipt?.hash ?? (executeTxResponse as { hash?: string }).hash
    console.log(`✅ Transaction executed: ${txHash}`)
    return txHash ?? ''
  }

  async createUnsignedTransactionPayload(
    to: string,
    value: string,
    data: string = '0x',
    creatorSignerAddress?: string
  ): Promise<TransactionPayload> {
    const signer = creatorSignerAddress ?? this.config.signers[0].address
    const kit = this.getProtocolKit(signer)
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
    const transactionData = safeTransaction.data as unknown as Record<string, unknown>
    const transactionDataSerialized = this.serializeTransactionData(transactionData)
    return { transactionData: transactionDataSerialized, safeTxHash }
  }

  async signTransactionHash(
    payload: TransactionPayload,
    signerAddress: string
  ): Promise<SignaturePayload> {
    const kit = this.getProtocolKit(signerAddress)
    const signature = await kit.signHash(payload.safeTxHash)
    return { signer: signature.signer, data: signature.data }
  }

  async executeWithSignatures(
    payload: TransactionPayload,
    signatures: SignaturePayload[],
    executorAddress: string
  ): Promise<string> {
    if (signatures.length < this.config.threshold) {
      throw new Error(
        `Need at least ${this.config.threshold} signatures, got ${signatures.length}`
      )
    }
    const transactionData = this.deserializeTransactionData(payload.transactionData)
    type SafeTxData = ConstructorParameters<typeof EthSafeTransaction>[0]
    const safeTransaction = new EthSafeTransaction(
      transactionData as unknown as SafeTxData
    )
    for (const sig of signatures) {
      safeTransaction.addSignature(new EthSafeSignature(sig.signer, sig.data))
    }
    const kit = this.getProtocolKit(executorAddress)
    const executeTxResponse = await kit.executeTransaction(safeTransaction)
    const txResponse = executeTxResponse.transactionResponse as
      | { wait(): Promise<{ hash: string }> }
      | null
      | undefined
    const receipt = txResponse ? await txResponse.wait() : null
    const txHash =
      receipt?.hash ?? (executeTxResponse as { hash?: string }).hash
    return txHash ?? ''
  }

  private serializeTransactionData(
    data: Record<string, unknown>
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'bigint') out[k] = v.toString()
      else if (v !== undefined && v !== null) out[k] = v
    }
    return out
  }

  private deserializeTransactionData(
    data: Record<string, unknown>
  ): Record<string, unknown> {
    const numericKeys = new Set([
      'value',
      'nonce',
      'safeTxGas',
      'baseGas',
      'gasPrice'
    ])
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
      if (numericKeys.has(k) && typeof v === 'string') {
        try {
          out[k] = BigInt(v)
        } catch {
          out[k] = v
        }
      } else {
        out[k] = v
      }
    }
    return out
  }

  async executeBatchTransaction(
    transactions: MetaTransactionData[],
    signerAddresses?: string[]
  ): Promise<string> {
    const signersToUse =
      signerAddresses ||
      this.config.signers.slice(0, this.config.threshold).map(s => s.address)
    const primaryKit = this.getProtocolKit(signersToUse[0])
    console.log(`\n📝 Creating batch transaction (${transactions.length} operations)...`)
    let safeTransaction = await primaryKit.createTransaction({ transactions })
    for (let i = 0; i < signersToUse.length; i++) {
      const signerAddress = signersToUse[i]
      const kit = this.getProtocolKit(signerAddress)
      console.log(`✍️  Signing batch with owner ${i + 1}/${signersToUse.length}: ${signerAddress}`)
      safeTransaction = await kit.signTransaction(safeTransaction)
    }
    console.log(`\n📤 Executing batch transaction...`)
    const executorKit = this.getProtocolKit(signersToUse[signersToUse.length - 1])
    const executeTxResponse = await executorKit.executeTransaction(safeTransaction)
    const txResponse = executeTxResponse.transactionResponse as
      | { wait(): Promise<{ hash: string }> }
      | null
      | undefined
    const receipt = txResponse ? await txResponse.wait() : null
    const txHash = receipt?.hash ?? (executeTxResponse as { hash?: string }).hash
    console.log(`✅ Batch transaction executed: ${txHash}`)
    return txHash ?? ''
  }

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

  async confirmTransaction(safeTxHash: string, signerAddress: string): Promise<void> {
    const kit = this.getProtocolKit(signerAddress)
    console.log(`\n✍️  Confirming transaction: ${safeTxHash}`)
    const signature = await kit.signHash(safeTxHash)
    await this.apiKit.confirmTransaction(safeTxHash, signature.data)
    console.log(`✅ Transaction confirmed by: ${signerAddress}`)
  }

  async getPendingTransactions(): Promise<any[]> {
    const safeAddress = await this.getProtocolKit(
      this.config.signers[0].address
    ).getAddress()
    const pendingTxs = await this.apiKit.getPendingTransactions(safeAddress)
    return pendingTxs.results
  }

  async executePendingTransaction(
    safeTxHash: string,
    executorAddress: string
  ): Promise<string> {
    const kit = this.getProtocolKit(executorAddress)
    console.log(`\n📤 Fetching transaction: ${safeTxHash}`)
    const safeTransaction = await this.apiKit.getTransaction(safeTxHash)
    console.log(
      `   Confirmations: ${safeTransaction.confirmations?.length || 0}/${this.config.threshold}`
    )
    if ((safeTransaction.confirmations?.length || 0) < this.config.threshold) {
      throw new Error(
        `Not enough confirmations. Need ${this.config.threshold}, have ${safeTransaction.confirmations?.length || 0}`
      )
    }
    console.log('📤 Executing transaction...')
    const executeTxResponse = await kit.executeTransaction(
      safeTransaction as Parameters<typeof kit.executeTransaction>[0]
    )
    const txResponse = executeTxResponse.transactionResponse as
      | { wait(): Promise<{ hash: string }> }
      | null
      | undefined
    const receipt = txResponse ? await txResponse.wait() : null
    const txHash =
      receipt?.hash ?? (executeTxResponse as { hash?: string }).hash
    console.log(`✅ Transaction executed: ${txHash}`)
    return txHash ?? ''
  }

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

  encodeContractCall(abi: any[], functionName: string, args: any[]): string {
    const iface = new ethers.Interface(abi)
    return iface.encodeFunctionData(functionName, args)
  }
}

// ============================================================================
// SERVER PATHS & SIGNER CONFIG (Polygon Amoy)
// ============================================================================

const POLYGON_AMOY_CHAIN_ID = 80002
const TX_SERVICE_URL =
  process.env.POLYGON_AMOY_TX_SERVICE_URL ||
  'https://safe-transaction-polygon-amoy.safe.global/api'

export const TX_FOLDER = 'tx_folder'
export const PAYLOAD_FOLDER = path.join(TX_FOLDER, 'payload')
export const SIGNATURE_FOLDER = path.join(TX_FOLDER, 'signature')
export const PAYLOAD_FILE = path.join(PAYLOAD_FOLDER, 'payload.json')

export function getSignatureFile(signerIndex: 1 | 2 | 3): string {
  return path.join(SIGNATURE_FOLDER, `signature-${signerIndex}.json`)
}

export function ensureTxFolders(): void {
  const cwd = process.cwd()
  fs.mkdirSync(path.resolve(cwd, PAYLOAD_FOLDER), { recursive: true })
  fs.mkdirSync(path.resolve(cwd, SIGNATURE_FOLDER), { recursive: true })
}

async function getSigners(): Promise<SignerConfig[]> {
  return [
    {
      privateKey: await getWalletPrivateKey(process.env.BACKEND_WALLET_1!) as string,
      address: process.env.SIGNER_1_ADDRESS!
    },
    {
      privateKey: await getWalletPrivateKey(process.env.BACKEND_WALLET_2!) as string,
      address: process.env.SIGNER_2_ADDRESS!
    },
    {
      privateKey: await getWalletPrivateKey(process.env.BACKEND_WALLET_3!) as string,
      address: process.env.SIGNER_3_ADDRESS!
    }
  ]
}

/**
 * Get config for a single signer by wallet key. Fetches only that wallet's secret from AWS.
 * Each signer server should pass its allocated wallet key (e.g. BACKEND_WALLET_1).
 */
export async function getSignerOnlyConfig(signerIndex: 1 | 2 | 3, walletKey: string): Promise<SafeConfig> {
  const privateKey = (await getWalletPrivateKey(walletKey)) as string
  const address = process.env[`SIGNER_${signerIndex}_ADDRESS`]!
  const signer: SignerConfig = { privateKey, address }
  return {
    rpcUrl: process.env.POLYGON_AMOY_RPC!,
    chainId: BigInt(POLYGON_AMOY_CHAIN_ID),
    safeAddress: process.env.POLYGON_AMOY_SAFE!,
    threshold: 2,
    signers: [signer],
    txServiceUrl: TX_SERVICE_URL
  }
}

export async function getFullConfig(): Promise<SafeConfig> {
  const signers = await getSigners()
  return {
    rpcUrl: process.env.POLYGON_AMOY_RPC!,
    chainId: BigInt(POLYGON_AMOY_CHAIN_ID),
    safeAddress: process.env.POLYGON_AMOY_SAFE!,
    threshold: 2,
    signers: [...signers],
    txServiceUrl: TX_SERVICE_URL
  }
}

/** Signer address from env for the given index (no AWS fetch). */
export function getSignerAddress(signerIndex: 1 | 2 | 3): string {
  return process.env[`SIGNER_${signerIndex}_ADDRESS`]!
}
