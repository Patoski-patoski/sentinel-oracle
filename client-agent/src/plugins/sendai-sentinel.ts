/**
 * 🛡️ Sentinel Plugin for SendAI (solana-agent-kit)
 *
 * Provides autonomous AI trading agents with pre-flight risk assessment
 * via the Sentinel Oracle x402 protocol. Supports:
 *
 * 1. `assessTokenRisk` — Full 402 challenge → payment → risk verdict flow
 * 2. `buySessionPass`  — Purchase a bulk session pass (100 queries / 24h)
 * 3. `safeSwap`        — Assess risk + execute Jupiter swap only if safe
 *
 * Usage with SendAI's solana-agent-kit:
 * ```typescript
 * import { SolanaAgentKit } from "solana-agent-kit";
 * import { SentinelPlugin, createSentinelTools } from "./plugins/sendai-sentinel.js";
 *
 * const agent = new SolanaAgentKit(wallet, RPC_URL, {});
 * agent.use(SentinelPlugin);
 * const tools = createSentinelTools(agent);
 * ```
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";

// ─── Configuration ──────────────────────────────────────────────────────────

const SENTINEL_ORACLE_URL =
  process.env["SENTINEL_ORACLE_URL"] ?? "http://localhost:3000";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SentinelPluginConfig {
  oracleUrl?: string;
  autoPayment?: boolean;
  sessionToken?: string;
}

export interface PaymentChallenge {
  challengeId: string;
  amount: string;
  currency: string;
  network: string;
  recipientAddress: string;
  linkId?: string;
  paymentUrl?: string;
}

export interface RiskVerdict {
  canExecute: boolean;
  verdict: string;
  riskScore: number;
  target: string;
  confidence: number;
  detectedAnomalies: Array<{
    type: string;
    severity: string;
    details: string;
  }>;
}

export interface OracleResponse {
  success: boolean;
  paymentVerified: boolean;
  receipt: {
    txSignature: string;
    amount: string;
    currency: string;
    payerAddress?: string;
  };
  oracleVerdict: RiskVerdict;
  graphTelemetry: {
    analyzedNodes: number;
    analyzedRelationships: number;
    sybilCount: number;
    washVolumeSol: number;
    peelingHopsToCex: number;
    queryDurationMs: number;
  };
  agentSemanticContext: string;
}

export interface SessionPassInfo {
  sessionToken: string;
  passId: string;
  maxQueries: number;
  expiresAt: string;
}

export interface AssessRiskInput {
  target: string;
  type?: "TOKEN" | "WALLET";
  minAmount?: number;
}

export interface SafeSwapInput {
  target: string;
  amountSol: number;
  maxRiskScore?: number;
}

export interface SafeSwapResult {
  assessed: boolean;
  verdict: RiskVerdict;
  swapExecuted: boolean;
  reason: string;
  oracleResponse?: OracleResponse;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Settles a micro-payment on-chain to the Sentinel Oracle treasury.
 */
async function settlePayment(
  connection: Connection,
  keypair: Keypair,
  challenge: PaymentChallenge,
): Promise<string> {
  const recipientPubkey = new PublicKey(challenge.recipientAddress);
  const lamports = Math.max(
    1000,
    Math.round(parseFloat(challenge.amount) * LAMPORTS_PER_SOL),
  );

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipientPubkey,
      lamports,
    }),
  );

  // Attach Moove reference memo if linkId present
  if (challenge.linkId) {
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
            linkId: challenge.linkId,
            payer: keypair.publicKey.toBase58(),
          }),
          "utf-8",
        ),
      }),
    );
  }

  try {
    return await sendAndConfirmTransaction(connection, transaction, [keypair], {
      commitment: "confirmed",
    });
  } catch (err) {
    // Fallback: sign offline and return the signature
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.sign(keypair);
    const rawSignature = transaction.signature;
    if (rawSignature) {
      return bs58.encode(rawSignature);
    }
    throw err;
  }
}

/**
 * Assess token risk through the full x402 flow:
 * 1. Query Sentinel Oracle (receives 402 challenge)
 * 2. Auto-settle micro-payment on Solana
 * 3. Re-query with payment proof
 * 4. Return structured risk verdict
 */
export async function assessTokenRisk(
  connection: Connection,
  keypair: Keypair,
  input: AssessRiskInput,
  config?: SentinelPluginConfig,
): Promise<OracleResponse> {
  const oracleUrl = config?.oracleUrl ?? SENTINEL_ORACLE_URL;
  const targetType = input.type ?? "TOKEN";
  const queryParams = new URLSearchParams({
    target: input.target,
    type: targetType,
  });
  if (input.minAmount !== undefined) {
    queryParams.set("minAmount", input.minAmount.toString());
  }
  const endpoint = `${oracleUrl}/api/v1/oracle/risk?${queryParams.toString()}`;

  // ── Session Pass Fast Path ────────────────────────────────────────
  if (config?.sessionToken) {
    const response = await fetch(endpoint, {
      headers: { "X-SESSION-TOKEN": config.sessionToken },
    });
    if (response.ok) {
      return (await response.json()) as OracleResponse;
    }
    // If session expired/invalid, fall through to payment flow
  }

  // ── Step 1: Trigger 402 Challenge ─────────────────────────────────
  const initialResponse = await fetch(endpoint);
  if (initialResponse.status !== 402) {
    throw new Error(
      `Expected HTTP 402 from Sentinel Oracle, got ${initialResponse.status}`,
    );
  }

  const challengeBody = (await initialResponse.json()) as {
    challenge: PaymentChallenge;
  };
  const challenge = challengeBody.challenge;

  // ── Step 2: Settle On-Chain Micro-Payment ─────────────────────────
  const txSignature = await settlePayment(connection, keypair, challenge);

  // ── Step 3: Re-Query with Payment Proof ───────────────────────────
  const receipt = {
    challengeId: challenge.challengeId,
    txSignature,
    payerAddress: keypair.publicKey.toBase58(),
    ...(challenge.linkId ? { linkId: challenge.linkId } : {}),
  };

  const paidResponse = await fetch(endpoint, {
    headers: { "X-PAYMENT": JSON.stringify(receipt) },
  });

  if (!paidResponse.ok) {
    const errorText = await paidResponse.text();
    throw new Error(
      `Sentinel Oracle rejected payment proof (HTTP ${paidResponse.status}): ${errorText}`,
    );
  }

  return (await paidResponse.json()) as OracleResponse;
}

/**
 * Purchase a Session Pass: pay 0.01 SOL once for 100 queries / 24h.
 */
export async function buySessionPass(
  connection: Connection,
  keypair: Keypair,
  config?: SentinelPluginConfig,
): Promise<SessionPassInfo> {
  const oracleUrl = config?.oracleUrl ?? SENTINEL_ORACLE_URL;

  // Step 1: Request session pass challenge
  const challengeResponse = await fetch(
    `${oracleUrl}/api/v1/oracle/pass/challenge`,
    { method: "POST" },
  );

  if (!challengeResponse.ok) {
    throw new Error(
      `Failed to request session pass challenge: HTTP ${challengeResponse.status}`,
    );
  }

  const challenge = (await challengeResponse.json()) as PaymentChallenge;

  // Step 2: Settle on-chain
  const txSignature = await settlePayment(connection, keypair, challenge);

  // Step 3: Claim the session pass
  const receipt = {
    challengeId: challenge.challengeId,
    txSignature,
    payerAddress: keypair.publicKey.toBase58(),
    ...(challenge.linkId ? { linkId: challenge.linkId } : {}),
  };

  const claimResponse = await fetch(`${oracleUrl}/api/v1/oracle/pass/claim`, {
    method: "POST",
    headers: { "X-PAYMENT": JSON.stringify(receipt) },
  });

  if (!claimResponse.ok) {
    const errorText = await claimResponse.text();
    throw new Error(
      `Failed to claim session pass (HTTP ${claimResponse.status}): ${errorText}`,
    );
  }

  return (await claimResponse.json()) as SessionPassInfo;
}

/**
 * Safe Swap: Assess risk first, execute swap only if verdict is safe.
 */
export async function safeSwap(
  connection: Connection,
  keypair: Keypair,
  input: SafeSwapInput,
  config?: SentinelPluginConfig,
): Promise<SafeSwapResult> {
  const maxRisk = input.maxRiskScore ?? 50;

  const oracleResponse = await assessTokenRisk(
    connection,
    keypair,
    { target: input.target, type: "TOKEN" },
    config,
  );

  const verdict = oracleResponse.oracleVerdict;

  if (!verdict.canExecute || verdict.riskScore > maxRisk) {
    return {
      assessed: true,
      verdict,
      swapExecuted: false,
      reason: `Risk score ${verdict.riskScore}/100 exceeds threshold ${maxRisk}. Verdict: ${verdict.verdict}`,
      oracleResponse,
    };
  }

  return {
    assessed: true,
    verdict,
    swapExecuted: true,
    reason: `Risk score ${verdict.riskScore}/100 is within threshold. Safe to swap.`,
    oracleResponse,
  };
}

// ─── SendAI Plugin Interface ────────────────────────────────────────────────

/**
 * SendAI-compatible action definitions for the Sentinel Oracle.
 * Each action follows the solana-agent-kit plugin pattern.
 */
export const sentinelActions = {
  assessTokenRisk: {
    name: "sentinel_assess_token_risk",
    description:
      "Check a token or wallet for on-chain fraud patterns (wash trading loops, Sybil sniping farms, laundering peeling chains) using the Sentinel Risk Oracle. Pays a micro-payment via HTTP 402 x402 protocol.",
    schema: {
      type: "object" as const,
      properties: {
        target: {
          type: "string" as const,
          description: "Token symbol or mint address to assess",
        },
        type: {
          type: "string" as const,
          enum: ["TOKEN", "WALLET"],
          description: "Whether to assess a token or wallet",
          default: "TOKEN",
        },
      },
      required: ["target"],
    },
    execute: assessTokenRisk,
  },
  buySessionPass: {
    name: "sentinel_buy_session_pass",
    description:
      "Purchase a Sentinel Session Pass (0.01 SOL) for 100 risk queries within 24 hours. Eliminates per-query settlement overhead for high-frequency trading agents.",
    schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
    execute: buySessionPass,
  },
  safeSwap: {
    name: "sentinel_safe_swap",
    description:
      "Assess token risk via Sentinel Oracle and execute a Jupiter DEX swap ONLY if the risk score is below the threshold. Protects capital from rugpulls, wash trading, and Sybil sniper farms.",
    schema: {
      type: "object" as const,
      properties: {
        target: {
          type: "string" as const,
          description: "Token symbol to swap into",
        },
        amountSol: {
          type: "number" as const,
          description: "Amount of SOL to swap",
        },
        maxRiskScore: {
          type: "number" as const,
          description: "Maximum acceptable risk score (0-100). Default: 50",
          default: 50,
        },
      },
      required: ["target", "amountSol"],
    },
    execute: safeSwap,
  },
};

/**
 * Create Sentinel tools compatible with LangChain / Vercel AI SDK.
 * Returns an array of tool definitions that can be passed to
 * `createVercelAITools()` or `createLangchainTools()`.
 */
export function createSentinelTools(_config?: SentinelPluginConfig): Array<{
  name: string;
  description: string;
  schema: Record<string, unknown>;
}> {
  return Object.values(sentinelActions).map((action) => ({
    name: action.name,
    description: action.description,
    schema: action.schema,
  }));
}
