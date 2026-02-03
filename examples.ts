import 'dotenv/config'
import { ethers } from 'ethers'
import { SafeMultisigManager, SafeConfig } from './safe-multisig'

// Polygon Amoy (chain ID 80002)
const POLYGON_AMOY_CHAIN_ID = 80002

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
]

/**
 * Step 1: Wallet 1 approves POLYGON_AMOY_SAFE to spend POLYGON_TEST_tUSDC.
 * Run: npm run polygon-approve
 */
async function wallet1ApproveSafe() {
  const rpcUrl = process.env.POLYGON_AMOY_RPC!
  const safeAddress = process.env.POLYGON_AMOY_SAFE!
  const tokenAddress = process.env.POLYGON_TEST_tUSDC!
  const wallet1Key = process.env.WALLET_1_PRIVATE_KEY || process.env.SIGNER_1_PRIVATE_KEY!
  const amountStr = process.env.APPROVE_AMOUNT || '1'
  const decimals = 6 // tUSDC

  
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet1 = new ethers.Wallet(wallet1Key, provider)
  const amount = ethers.parseUnits(amountStr, decimals)

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet1)

  console.log('\n📝 Wallet 1 approving Safe to spend tUSDC (Polygon Amoy)...')
  console.log(`   Token: ${tokenAddress}`)
  console.log(`   Safe:  ${safeAddress}`)
  console.log(`   Amount: ${amountStr} tUSDC`)

  const tx = await token.approve(safeAddress, amount)
  console.log('   Tx hash:', tx.hash)
  await tx.wait()
  console.log('✅ Approval confirmed.')

  const allowance = await token.allowance(wallet1.address, safeAddress)
  console.log('   Allowance (Safe can spend):', ethers.formatUnits(allowance, decimals), 'tUSDC')
}

/**
 * Step 2: Safe (POLYGON_AMOY_SAFE) executes transferFrom(wallet1, wallet2, amount).
 * Requires Wallet 1 to have approved the Safe first (run polygon-approve).
 * Run: npm run polygon-transfer
 */
async function runPolygonAmoySafeTransfer(): Promise<string> {
  const txServiceUrl = process.env.POLYGON_AMOY_TX_SERVICE_URL || 'https://safe-transaction-polygon-amoy.safe.global/api'
  const config: SafeConfig = {
    rpcUrl: process.env.POLYGON_AMOY_RPC!,
    chainId: BigInt(POLYGON_AMOY_CHAIN_ID),
    safeAddress: process.env.POLYGON_AMOY_SAFE!,
    threshold: 2,
    signers: [
      { privateKey: process.env.SIGNER_1_PRIVATE_KEY!, address: process.env.SIGNER_1_ADDRESS! },
      { privateKey: process.env.SIGNER_2_PRIVATE_KEY!, address: process.env.SIGNER_2_ADDRESS! },
      { privateKey: process.env.SIGNER_3_PRIVATE_KEY!, address: process.env.SIGNER_3_ADDRESS! }
    ],
    txServiceUrl
  }

  const manager = new SafeMultisigManager(config)
  await manager.initialize()

  const tokenAddress = process.env.POLYGON_TEST_tUSDC!
  const wallet1Address = process.env.WALLET_1_ADDRESS || process.env.SIGNER_1_ADDRESS!
  const recipientAddress = process.env.RECIPIENT_ADDRESS || process.env.WALLET_2_ADDRESS
  const amountStr = process.env.TRANSFER_AMOUNT || '1'
  const amount = ethers.parseUnits(amountStr, 6).toString()

  const erc20Iface = new ethers.Interface(ERC20_ABI)
  const data = erc20Iface.encodeFunctionData('transferFrom', [
    wallet1Address,
    recipientAddress,
    amount
  ])

  console.log('\n📤 Safe executing transferFrom (Polygon Amoy)...')
  console.log(`   From: ${wallet1Address}`)
  console.log(`   To:   ${recipientAddress}`)
  console.log(`   Amount: ${amountStr} tUSDC`)

  const allSignerAddresses = config.signers.map((s) => s.address)
  const txHash = await manager.executeTransaction(tokenAddress, '0', data, allSignerAddresses)
  return txHash
}

/**
 * Full flow: Wallet 1 approve → Safe transferFrom(wallet1 → wallet2).
 * Run: npm run polygon-transfer-flow
 */
async function polygonApproveAndTransfer() {
  console.log('\n=== Polygon Amoy: Approve + Safe Transfer (tUSDC) ===\n')
  await wallet1ApproveSafe()
  console.log('')
  const txHash = await runPolygonAmoySafeTransfer()
  console.log('\n✅ Flow complete. Safe transfer tx:', txHash)
}

// CLI
const command = process.argv[2]

switch (command) {
  case 'polygon-approve':
    wallet1ApproveSafe().catch((e) => { console.error(e); process.exit(1) })
    break
  case 'polygon-transfer':
    runPolygonAmoySafeTransfer()
      .then((txHash) => console.log('\n✅ Safe transfer executed:', txHash))
      .catch((e) => { console.error(e); process.exit(1) })
    break
  case 'polygon-transfer-flow':
    polygonApproveAndTransfer().catch((e) => { console.error(e); process.exit(1) })
    break
  default:
    console.log('Usage: npm run <script>')
    console.log('  polygon-approve        - Wallet 1 approve tUSDC for Safe (Polygon Amoy)')
    console.log('  polygon-transfer       - Safe transferFrom wallet1 → wallet2 (Polygon Amoy)')
    console.log('  polygon-transfer-flow - Approve + Safe transfer in one run')
}

export { wallet1ApproveSafe, runPolygonAmoySafeTransfer, polygonApproveAndTransfer }
