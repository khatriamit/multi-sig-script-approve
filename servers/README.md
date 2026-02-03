# Multi-server signing

One file per signer server, plus coordinator and executor. Artifacts live under `tx_folder/`.

## Folder structure

```
tx_folder/
  payload/
    payload.json      # from coordinator
  signature/
    signature-1.json  # from signer-server-1
    signature-2.json  # from signer-server-2
    signature-3.json  # from signer-server-3
```

## Files

| File | Role |
|------|------|
| `config.ts` | Shared config (env, paths under `tx_folder/`). |
| `coordinator.ts` | Creates unsigned tx, writes `tx_folder/payload/payload.json`. |
| `signer-server-1.ts` | Signer 1: reads payload, signs, writes `tx_folder/signature/signature-1.json`. |
| `signer-server-2.ts` | Signer 2: reads payload, signs, writes `tx_folder/signature/signature-2.json`. |
| `signer-server-3.ts` | Signer 3: reads payload, signs, writes `tx_folder/signature/signature-3.json`. |
| `executor.ts` | Reads payload + signatures from `tx_folder/`, executes Safe tx. |

## Flow

1. **Coordinator** (one machine): `npm run server:coordinator`  
   Creates `tx_folder/payload/` and `tx_folder/signature/` if needed, writes `tx_folder/payload/payload.json`.

2. **Signer servers** (each on its own machine, or same machine for testing):  
   - `npm run server:signer-1` → writes `tx_folder/signature/signature-1.json`  
   - `npm run server:signer-2` → writes `tx_folder/signature/signature-2.json`  
   - `npm run server:signer-3` → writes `tx_folder/signature/signature-3.json`  

   Each needs `tx_folder/payload/payload.json` and only its own `SIGNER_*_PRIVATE_KEY` / `SIGNER_*_ADDRESS` in `.env`.

3. **Executor** (e.g. coordinator or any server with payload + at least 2 signatures):  
   `npm run server:executor`  
   Reads `tx_folder/payload/payload.json` and `tx_folder/signature/signature-*.json`, executes the tx.

## Env

- All: `POLYGON_AMOY_RPC`, `POLYGON_AMOY_SAFE`, `POLYGON_TEST_tUSDC`, `RECIPIENT_ADDRESS` (or `WALLET_2_ADDRESS`), `TRANSFER_AMOUNT`.
- Coordinator/executor: need at least one signer’s keys (e.g. signer 1).
- Signer server N: only `SIGNER_N_PRIVATE_KEY` and `SIGNER_N_ADDRESS` (others optional).

In production, copy only `tx_folder/payload/payload.json` to each signer server and copy back the `tx_folder/signature/signature-*.json` files to the executor (or use your own transport).
