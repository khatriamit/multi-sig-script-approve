
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import "dotenv/config";

const secret_name = process.env.AWS_SIGNERS_SECRET_PREFIX ?? "";


const client = new SecretsManagerClient({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
  region: process.env.AWS_REGION ?? "",
});

/**
 * Fetches the secret from AWS, parses it as JSON, and returns the value for the given wallet key.
 * @param wallet - The key to look up in the secret object (e.g. "wallet1", "signer-1")
 * @returns The value for that key, or undefined if not found
 */
export async function getWalletPrivateKey(wallet: string): Promise<unknown> {
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secret_name,
      VersionStage: "AWSCURRENT",
    })
  );
  const raw = response.SecretString;
  if (!raw) return undefined;
  const secret = JSON.parse(raw) as Record<string, unknown>;
  return secret[wallet];
}

// async function main() {
//   const secret = await getSecretValueByWallet("wallet"); // example key
//   console.log("secret", secret);
// }

// main().catch((e) => {
//   console.error(e);
//   process.exit(1);
// });