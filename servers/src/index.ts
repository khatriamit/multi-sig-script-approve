/**
 * Index: runs the full multisig flow sequentially when triggered.
 * Flow: Coordinator → Signer 1 → Signer 2 → Signer 3 → Executor
 *
 * Run: npx ts-node servers/src/index.ts
 * Or:  npm run flow
 */
import { main as runCoordinator } from './coordinator'
import { main as runSigner1 } from './signer-server-1'
import { main as runSigner2 } from './signer-server-2'
import { main as runSigner3 } from './signer-server-3'
import { main as runExecutor } from './executor'

export async function runFlow(): Promise<void> {
  console.log('——— Starting multisig flow ———\n')

  console.log('[1/5] Coordinator: creating unsigned payload...')
  await runCoordinator()
  console.log('')

  console.log('[2/5] Signer 1: signing...')
  await runSigner1()
  console.log('')

  console.log('[3/5] Signer 2: signing...')
  await runSigner2()
  console.log('')

  console.log('[4/5] Signer 3: signing...')
  await runSigner3()
  console.log('')

  console.log('[5/5] Executor: executing transaction...')
  await runExecutor()

  console.log('\n——— Flow completed ———')
}

async function main() {
  await runFlow()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
