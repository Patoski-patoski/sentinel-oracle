/**
 * 🤖 Sentinel Autonomous On-Chain Trading Agent
 *
 * An autonomous machine-to-machine AI trader that:
 * 1. Monitors liquidity pools for new trading opportunities.
 * 2. Intercepts HTTP 402 Payment Required challenges from Sentinel Oracle.
 * 3. Uses its local Solana keypair to settle micro-payments on-chain.
 * 4. Verifies settlement with cryptographic proof via X-PAYMENT header.
 * 5. Consumes Gemini-powered graph risk intelligence.
 * 6. Records swap intent on-chain when safe, or protects capital when fraud is detected.
 */

import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getOrCreateAgentWallet,
  ensureWalletFunded,
  settlePaymentOnChain,
} from "./wallet.js";
import { getJupiterQuote, executeDEXSwap } from "./jupiter.js";
import { streamLiquidityEvents } from "./monitor.js";

const ORACLE_BASE_URL =
  process.env["SENTINEL_ORACLE_URL"] ?? "http://localhost:3000";
const SOLANA_RPC_URL =
  process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";
const TRADE_AMOUNT_SOL = parseFloat(process.env["TRADE_AMOUNT_SOL"] ?? "0.01");

const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

interface PaymentChallengePayload {
  status: number;
  error: string;
  message: string;
  challenge: {
    challengeId: string;
    amount: string;
    currency: string;
    network: string;
    recipient: string;
    recipientAddress: string;
    linkId?: string;
    paymentUrl?: string;
    validUntil: string;
    instructions: {
      headerName: string;
      format: string;
    };
  };
}

interface OracleResponsePayload {
  success: boolean;
  paymentVerified: boolean;
  receipt: {
    txSignature: string;
    amount: string;
    currency: string;
  };
  oracleVerdict: {
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
  };
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAutonomousTrader(): Promise<void> {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => !a.startsWith("-"));
  const isLoop = args.includes("--loop") || args.includes("-l") || !targetArg;
  const singleTarget = targetArg ?? "MOON";

  console.log(
    `\n${COLORS.bold}${COLORS.cyan}========================================================================${COLORS.reset}`,
  );
  console.log(
    `${COLORS.bold}🤖 SENTINEL AUTONOMOUS AGENT: MACHINE-TO-MACHINE (A2A) TRADER${COLORS.reset}`,
  );
  console.log(
    `${COLORS.dim}Mode: ${isLoop ? "Continuous Liquidity Monitor" : `Single Target Check ($${singleTarget})`} | Network: Solana Devnet${COLORS.reset}`,
  );
  console.log(
    `${COLORS.cyan}========================================================================${COLORS.reset}\n`,
  );

  // 1. Initialize Solana Connection and Wallet
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const wallet = getOrCreateAgentWallet();

  console.log(
    `[AGENT SETUP] Public Key:       ${COLORS.bold}${wallet.publicKey}${COLORS.reset}`,
  );
  console.log(
    `[AGENT SETUP] Oracle Endpoint:  ${COLORS.dim}${ORACLE_BASE_URL}${COLORS.reset}`,
  );
  console.log(
    `[AGENT SETUP] Solana RPC:       ${COLORS.dim}${SOLANA_RPC_URL}${COLORS.reset}`,
  );

  const balance = await ensureWalletFunded(connection, wallet.keypair);
  console.log(
    `[AGENT SETUP] Wallet Balance:   ${COLORS.green}${balance.toFixed(4)} SOL${COLORS.reset}\n`,
  );

  let cycle = 0;
  let capitalProtectedCount = 0;
  let swapsExecutedCount = 0;

  const runCycle = async (tokenSymbol: string, poolDex: string) => {
    cycle++;
    console.log(
      `${COLORS.cyan}------------------------------------------------------------------------${COLORS.reset}`,
    );
    console.log(
      `${COLORS.bold}[CYCLE #${cycle}] Detected Liquidity Pool: ${COLORS.yellow}$${tokenSymbol}${COLORS.reset} on ${poolDex}`,
    );
    console.log(
      `${COLORS.dim}Evaluating trade execution for ${TRADE_AMOUNT_SOL} SOL...${COLORS.reset}\n`,
    );

    await sleep(400);

    // Step A: Send Pre-execution Request to Sentinel Oracle
    console.log(
      `${COLORS.cyan}[A2A PROTOCOL: STEP 1]${COLORS.reset} Querying Sentinel Risk Oracle...`,
    );
    console.log(
      `         ${COLORS.dim}GET ${ORACLE_BASE_URL}/api/v1/oracle/risk?target=${tokenSymbol}&type=TOKEN${COLORS.reset}`,
    );

    let initialResponse: Response;
    try {
      initialResponse = await fetch(
        `${ORACLE_BASE_URL}/api/v1/oracle/risk?target=${tokenSymbol}&type=TOKEN`,
      );
    } catch (err) {
      console.error(
        `\n${COLORS.red}❌ Error connecting to Sentinel Oracle at ${ORACLE_BASE_URL}:${COLORS.reset}`,
        err instanceof Error ? err.message : String(err),
      );
      console.error(`Ensure Sentinel backend is running (bun run dev)\n`);
      return;
    }

    // Step B: Handle HTTP 402 Payment Required Challenge
    if (initialResponse.status !== 402) {
      console.warn(`Unexpected HTTP status: ${initialResponse.status}`);
      return;
    }

    const challengePayload =
      (await initialResponse.json()) as PaymentChallengePayload;
    const challenge = challengePayload.challenge;

    console.log(
      `\n${COLORS.yellow}[A2A PROTOCOL: STEP 2] HTTP 402 Payment Required received!${COLORS.reset}`,
    );
    console.log(
      `         Protocol:        ${COLORS.magenta}${initialResponse.headers.get("x-payment-protocol") ?? "moove-x402-v1"}${COLORS.reset}`,
    );
    console.log(
      `         Challenge ID:    ${COLORS.bold}${challenge.challengeId}${COLORS.reset}`,
    );
    console.log(
      `         Invoice Amount:  ${COLORS.bold}${challenge.amount} ${challenge.currency}${COLORS.reset}`,
    );
    console.log(
      `         Settlement Rail: Solana Devnet -> ${challenge.recipientAddress.substring(0, 16)}...`,
    );

    await sleep(400);

    // Step C: Autonomous Micro-Payment Settlement on Solana
    console.log(
      `\n${COLORS.cyan}[A2A PROTOCOL: STEP 3] Signing & broadcasting on-chain micro-payment...${COLORS.reset}`,
    );

    let txSignature: string;
    try {
      txSignature = await settlePaymentOnChain(
        connection,
        wallet.keypair,
        challenge.recipientAddress,
        parseFloat(challenge.amount),
        challenge.linkId,
      );
      console.log(
        `         ${COLORS.green}✔ Transaction confirmed on Solana Devnet!${COLORS.reset}`,
      );
      console.log(
        `         Tx Hash: ${COLORS.dim}${txSignature}${COLORS.reset}`,
      );
      console.log(
        `         Explorer: ${COLORS.cyan}https://explorer.solana.com/tx/${txSignature}?cluster=devnet${COLORS.reset}`,
      );
      if (challenge.linkId) {
        console.log(
          `         Moove Reference: ${COLORS.magenta}${challenge.linkId}${COLORS.reset}`,
        );
      }
    } catch (paymentErr) {
      console.error(
        `         ${COLORS.red}❌ On-chain payment settlement failed: ${paymentErr instanceof Error ? paymentErr.message : String(paymentErr)}${COLORS.reset}`,
      );
      return;
    }

    await sleep(500);

    // Step D: Re-submitting Oracle Request with On-Chain Proof
    console.log(
      `\n${COLORS.cyan}[A2A PROTOCOL: STEP 4] Re-submitting query with X-PAYMENT cryptographic receipt...${COLORS.reset}`,
    );

    const receipt = {
      challengeId: challenge.challengeId,
      txSignature,
      payerAddress: wallet.publicKey,
      ...(challenge.linkId ? { linkId: challenge.linkId } : {}),
    };

    let oracleResult: OracleResponsePayload;
    try {
      const oracleResponse = await fetch(
        `${ORACLE_BASE_URL}/api/v1/oracle/risk?target=${tokenSymbol}&type=TOKEN`,
        {
          headers: {
            "X-PAYMENT": JSON.stringify(receipt),
          },
        },
      );

      if (!oracleResponse.ok) {
        console.error(
          `${COLORS.red}❌ Oracle returned HTTP ${oracleResponse.status}${COLORS.reset}`,
        );
        console.error(await oracleResponse.text());
        return;
      }

      oracleResult = (await oracleResponse.json()) as OracleResponsePayload;
    } catch (networkErr) {
      console.error(
        `${COLORS.red}❌ Failed to reach Sentinel Oracle after payment: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}${COLORS.reset}`,
      );
      return;
    }
    console.log(
      `         ${COLORS.green}${COLORS.bold}HTTP 200 OK — Payment Verified by Sentinel! Risk payload unlocked.${COLORS.reset}`,
    );

    await sleep(400);

    // Step E: Machine Verdict & Telemetry Analysis
    try {
      const verdict = oracleResult.oracleVerdict;
      const telemetry = oracleResult.graphTelemetry;

      console.log(
        `\n${COLORS.bold}[ORACLE INTELLIGENCE REPORT FOR $${tokenSymbol}]:${COLORS.reset}`,
      );
      console.log(
        `  • Verdict:          ${verdict.canExecute ? COLORS.green : COLORS.red}${COLORS.bold}${verdict.verdict}${COLORS.reset}`,
      );
      console.log(
        `  • Risk Score:       ${verdict.riskScore >= 70 ? COLORS.red : COLORS.green}${COLORS.bold}${verdict.riskScore}/100${COLORS.reset} (Confidence: ${(verdict.confidence * 100).toFixed(0)}%)`,
      );
      console.log(
        `  • Graph Telemetry:  ${telemetry.analyzedNodes} nodes traversed in ${telemetry.queryDurationMs}ms`,
      );
      if (telemetry.washVolumeSol > 0) {
        console.log(
          `  • Wash Volume:      ${COLORS.red}$${telemetry.washVolumeSol.toLocaleString()} SOL cycling in loops${COLORS.reset}`,
        );
      }
      if (telemetry.sybilCount > 0) {
        console.log(
          `  • Sybil Cluster:    ${COLORS.red}${telemetry.sybilCount} coordinated sniping wallets${COLORS.reset}`,
        );
      }
      console.log(
        `  • Gemini AI Directive:\n    ${COLORS.dim}"${oracleResult.agentSemanticContext}"${COLORS.reset}`,
      );

      // Step F: Autonomous Trade Decision & DEX Execution
      if (verdict.canExecute) {
        console.log(
          `\n${COLORS.green}${COLORS.bold}✅ [DECISION: APPROVE SWAP] Token passed Sentinel safety inspection.${COLORS.reset}`,
        );
        console.log(`   Routing optimal swap through Jupiter DEX engine...`);

        try {
          const quote = await getJupiterQuote(
            "SOL",
            tokenSymbol,
            TRADE_AMOUNT_SOL,
          );
          console.log(`   Route:            ${quote.route}`);
          console.log(
            `   Expected Output:  ${quote.outAmount} $${tokenSymbol}`,
          );
          console.log(`   Price Impact:     ${quote.priceImpactPct}`);

          console.log(`   Broadcasting swap transaction to Solana...`);
          const swapResult = await executeDEXSwap(
            connection,
            wallet.keypair,
            "SOL",
            tokenSymbol,
            TRADE_AMOUNT_SOL,
            quote,
          );
          swapsExecutedCount++;
          console.log(
            `   ${COLORS.green}✔ Swap Intent Recorded On-Chain!${COLORS.reset}`,
          );
          console.log(
            `   Swap Tx:   ${COLORS.dim}${swapResult.txSignature}${COLORS.reset}`,
          );
          console.log(
            `   Explorer:  ${COLORS.cyan}https://explorer.solana.com/tx/${swapResult.txSignature}?cluster=devnet${COLORS.reset}`,
          );
        } catch (swapErr) {
          console.warn(
            `   ⚠️ Swap failed: ${swapErr instanceof Error ? swapErr.message : String(swapErr)}`,
          );
        }
      } else {
        capitalProtectedCount++;
        console.log(
          `\n${COLORS.red}${COLORS.bold}🚨 [DECISION: ABORT SWAP] Sentinel identified critical on-chain threat.${COLORS.reset}`,
        );
        console.log(
          `   ${COLORS.bold}Capital Protection:${COLORS.reset} Refused to deploy ${TRADE_AMOUNT_SOL} SOL into fraudulent pool.`,
        );
        console.log(
          `   Anomalies Detected: ${verdict.detectedAnomalies.map((a) => `[${a.type}]`).join(", ")}`,
        );
      }
    } catch (parseErr) {
      console.error(
        `${COLORS.red}❌ Failed to parse oracle response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}${COLORS.reset}`,
      );
    }

    // Update balance
    const currentLamports = await connection.getBalance(
      wallet.keypair.publicKey,
    );
    console.log(
      `\n[AGENT STATUS] Agent Balance: ${(currentLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL | Swaps Executed: ${swapsExecutedCount} | Threats Neutralized: ${capitalProtectedCount}\n`,
    );
  };

  if (!isLoop) {
    await runCycle(singleTarget.toUpperCase(), "Raydium CPMM");
    return;
  }

  // Continuous loop
  let poolIndex = 0;
  for await (const event of streamLiquidityEvents(7000)) {
    await runCycle(event.tokenSymbol, event.dex);
    poolIndex++;
    if (poolIndex >= 4) {
      console.log(
        `${COLORS.cyan}[MONITOR] Continuous monitor completed demonstration batch (4 cycles). Press Ctrl+C to stop or run again.${COLORS.reset}\n`,
      );
      break;
    }
  }
}

runAutonomousTrader().catch((err) => {
  console.error(err);
  process.exit(1);
});
