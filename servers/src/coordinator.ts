/**
 * Coordinator: creates the unsigned transaction payload and writes it to tx_folder/payload/payload.json.
 * Run this first. Then run each signer server (signer-server-1, 2, 3). Then run executor.
 *
 * Run: npx ts-node servers/coordinator.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { ethers } from 'ethers'
import {
  SafeMultisigManager,
  getFullConfig,
  getSignerAddress,
  PAYLOAD_FILE,
  ensureTxFolders
} from './config'
import type { TransactionPayload } from './config'

const ERC20_ABI = [
  'function transferFrom(address from, address to, uint256 amount) returns (bool)'
]

export async function main() {
  const tokenAddress = process.env.POLYGON_TEST_tUSDC!
  const wallet1Address =
    process.env.WALLET_1_ADDRESS || process.env.SIGNER_1_ADDRESS!
  const recipientAddress =
    process.env.RECIPIENT_ADDRESS || process.env.WALLET_2_ADDRESS!
  const amountStr = process.env.TRANSFER_AMOUNT || '1'
  const amount = ethers.parseUnits(amountStr, 6).toString()

  const iface = new ethers.Interface(ERC20_ABI)
  const data = iface.encodeFunctionData('transferFrom', [
    wallet1Address,
    recipientAddress,
    amount
  ])

  const config = await getFullConfig()
  const manager = new SafeMultisigManager(config)
  await manager.initialize()

  const creatorAddress = getSignerAddress(1)
  const payload: TransactionPayload =
    await manager.createUnsignedTransactionPayload(
      tokenAddress,
      '0',
      data,
      creatorAddress
    )

  ensureTxFolders()
  const outPath = path.resolve(process.cwd(), PAYLOAD_FILE)
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`Payload written to ${outPath}`)
  console.log('Next: run signer-server-1, signer-server-2, signer-server-3, then executor.')
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
