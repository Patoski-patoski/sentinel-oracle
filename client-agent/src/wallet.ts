import {
  Keypair,
  PublicKey,
  Connection,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as fs from "node:fs";
import * as path from "node:path";

export interface AgentWallet {
  keypair: Keypair;
  publicKey: string;
}

const WALLET_FILE_NAME = ".agent-wallet.json";

/**
 * Loads an existing Solana Keypair or creates and persists a new one.
 * Resolution order:
 * 1. AGENT_PRIVATE_KEY environment variable (base58 or byte array JSON)
 * 2. .agent-wallet.json file in current working directory or script directory
 * 3. Newly generated Keypair saved to .agent-wallet.json
 */
export function getOrCreateAgentWallet(): AgentWallet {
  const envKey = process.env["AGENT_PRIVATE_KEY"];
  if (envKey && envKey.trim().length > 0) {
    const trimmed = envKey.trim();
    try {
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        const parsed = JSON.parse(trimmed) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.every((n) => typeof n === "number")
        ) {
          const secretKey = new Uint8Array(parsed as number[]);
          const keypair = Keypair.fromSecretKey(secretKey);
          return { keypair, publicKey: keypair.publicKey.toBase58() };
        }
      }
      const decoded = bs58.decode(trimmed);
      const keypair = Keypair.fromSecretKey(decoded);
      return { keypair, publicKey: keypair.publicKey.toBase58() };
    } catch (err) {
      console.warn(
        `[WALLET] Warning: Failed to parse AGENT_PRIVATE_KEY: ${err instanceof Error ? err.message : String(err)}. Falling back to file wallet.`,
      );
    }
  }

  // Look for .agent-wallet.json
  const candidatePaths = [
    path.resolve(process.cwd(), WALLET_FILE_NAME),
    path.resolve(process.cwd(), "client-agent", WALLET_FILE_NAME),
  ];

  for (const filePath of candidatePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (
          Array.isArray(parsed) &&
          parsed.every((n) => typeof n === "number")
        ) {
          const secretKey = new Uint8Array(parsed as number[]);
          const keypair = Keypair.fromSecretKey(secretKey);
          return { keypair, publicKey: keypair.publicKey.toBase58() };
        }
      } catch (err) {
        console.warn(`[WALLET] Could not read ${filePath}: ${String(err)}`);
      }
    }
  }

  // Generate new keypair and persist it
  const newKeypair = Keypair.generate();
  const savePath =
    candidatePaths[0] ?? path.resolve(process.cwd(), WALLET_FILE_NAME);
  try {
    const data = JSON.stringify(Array.from(newKeypair.secretKey));
    fs.writeFileSync(savePath, data, "utf-8");
    console.log(
      `[WALLET] Generated new autonomous trader wallet: ${newKeypair.publicKey.toBase58()} (saved to ${path.basename(savePath)})`,
    );
  } catch (err) {
    console.warn(
      `[WALLET] Notice: Could not persist wallet to disk (${String(err)}). Using in-memory keypair.`,
    );
  }

  return { keypair: newKeypair, publicKey: newKeypair.publicKey.toBase58() };
}

/**
 * Checks current SOL balance and attempts a faucet airdrop on Devnet if needed.
 */
export async function ensureWalletFunded(
  connection: Connection,
  keypair: Keypair,
  minSol = 0.05,
): Promise<number> {
  let lamports = await connection.getBalance(keypair.publicKey);
  let sol = lamports / LAMPORTS_PER_SOL;

  if (sol < minSol) {
    console.log(
      `[WALLET] Balance is low (${sol.toFixed(4)} SOL). Requesting Devnet airdrop of 1.0 SOL...`,
    );
    try {
      const airdropSig = await connection.requestAirdrop(
        keypair.publicKey,
        1 * LAMPORTS_PER_SOL,
      );
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature: airdropSig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });
      lamports = await connection.getBalance(keypair.publicKey);
      sol = lamports / LAMPORTS_PER_SOL;
      console.log(
        `[WALLET] ✔ Airdrop confirmed! New balance: ${sol.toFixed(4)} SOL`,
      );
    } catch (err) {
      console.warn(
        `[WALLET] ⚠️ Devnet airdrop rate-limited or unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.warn(
        `[WALLET] You can manually fund ${keypair.publicKey.toBase58()} via https://faucet.solana.com`,
      );
    }
  }

  return sol;
}

/**
 * Settles a micro-payment on Solana Devnet by broadcasting a SystemProgram.transfer
 * transaction with a Moove linkId memo for settlement tracking, and waiting for
 * confirmed commitment.
 */
export async function settlePaymentOnChain(
  connection: Connection,
  keypair: Keypair,
  recipientAddress: string,
  amountSol: number,
  mooveLinkId?: string,
): Promise<string> {
  let toPublicKey: PublicKey;
  try {
    toPublicKey = new PublicKey(recipientAddress);
  } catch {
    throw new Error(
      `Invalid recipient Solana address in payment challenge: "${recipientAddress}"`,
    );
  }

  // Ensure lamports is at least 1000 to prevent zero-transfer issues
  const lamports = Math.max(1000, Math.round(amountSol * LAMPORTS_PER_SOL));

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: toPublicKey,
      lamports,
    }),
  );

  // Attach Moove payment reference memo when linkId is available
  // so the settlement can be tracked on the Moove dashboard.
  if (mooveLinkId) {
    const MEMO_PROGRAM = new PublicKey(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    transaction.add(
      new TransactionInstruction({
        keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
        programId: MEMO_PROGRAM,
        data: Buffer.from(
          JSON.stringify({
            protocol: "moove-x402-v1",
            linkId: mooveLinkId,
            payer: keypair.publicKey.toBase58(),
          }),
          "utf-8",
        ),
      }),
    );
  }

  try {
    const txSignature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],
      { commitment: "confirmed" },
    );
    return txSignature;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[WALLET] ❌ On-chain payment settlement failed: ${errMsg}`);
    throw err;
  }
}
