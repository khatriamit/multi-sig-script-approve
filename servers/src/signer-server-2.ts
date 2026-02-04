/**
 * Signer server 2: reads transaction payload, signs with SIGNER_2, writes to tx_folder/signature/signature-2.json
 * Run: npx ts-node servers/signer-server-2.ts
 * Prereq: coordinator has been run so tx_folder/payload/payload.json exists.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  SafeMultisigManager,
  type TransactionPayload,
  getSignerOnlyConfig,
  getSignerAddress,
  PAYLOAD_FILE,
  getSignatureFile,
  ensureTxFolders
} from './config'

const SIGNER_INDEX = 2 as const

export async function main() {
  const payloadPath = path.resolve(process.cwd(), PAYLOAD_FILE)
  if (!fs.existsSync(payloadPath)) {
    console.error(`Missing ${PAYLOAD_FILE}. Run coordinator first.`)
    process.exit(1)
  }

  const payload: TransactionPayload = JSON.parse(
    fs.readFileSync(payloadPath, 'utf-8')
  )
  const walletKey = process.env.BACKEND_WALLET_2!
  const config = await getSignerOnlyConfig(SIGNER_INDEX, walletKey)
  const manager = new SafeMultisigManager(config)
  await manager.initialize()

  const signerAddress = getSignerAddress(SIGNER_INDEX)
  const signature = await manager.signTransactionHash(payload, signerAddress)

  ensureTxFolders()
  const outPath = path.resolve(process.cwd(), getSignatureFile(SIGNER_INDEX))
  fs.writeFileSync(outPath, JSON.stringify(signature, null, 2))
  console.log(`Signer ${SIGNER_INDEX} signed. Signature written to ${outPath}`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
