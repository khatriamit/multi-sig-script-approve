/**
 * Executor: reads tx_folder/payload/payload.json and tx_folder/signature/signature-*.json,
 * then executes the Safe transaction (needs at least threshold signatures).
 *
 * Run: npx ts-node servers/executor.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  SafeMultisigManager,
  type TransactionPayload,
  type SignaturePayload,
  getFullConfig,
  getSignerAddress,
  PAYLOAD_FILE,
  getSignatureFile
} from './config'

async function main() {
  const payloadPath = path.resolve(process.cwd(), PAYLOAD_FILE)
  if (!fs.existsSync(payloadPath)) {
    console.error(`Missing ${PAYLOAD_FILE}. Run coordinator first.`)
    process.exit(1)
  }

  const payload: TransactionPayload = JSON.parse(
    fs.readFileSync(payloadPath, 'utf-8')
  )

  const signatures: SignaturePayload[] = []
  for (const i of [1, 2, 3] as const) {
    const sigPath = path.resolve(process.cwd(), getSignatureFile(i))
    if (fs.existsSync(sigPath)) {
      const sig = JSON.parse(fs.readFileSync(sigPath, 'utf-8')) as SignaturePayload
      signatures.push(sig)
    }
  }

  if (signatures.length < 2) {
    console.error(
      `Need at least 2 signatures (threshold). Found ${signatures.length}. Run signer-server-1, signer-server-2, (signer-server-3).`
    )
    process.exit(1)
  }

  const config = getFullConfig()
  const manager = new SafeMultisigManager(config)
  await manager.initialize()

  const executorAddress = getSignerAddress(1)
  const txHash = await manager.executeWithSignatures(
    payload,
    signatures,
    executorAddress
  )
  console.log('Transaction executed:', txHash)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
