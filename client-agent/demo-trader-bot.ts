/**
 * 🤖 Sentinel Demo Client Agent (Autonomous Trading Bot)
 * Demonstrates the Agent-to-Agent (A2A) x402 Micro-Payment Protocol
 */

/**
 * Provide a minimal ambient declaration for `process.argv` so TypeScript
 * can compile this Bun/Node-compatible script without requiring @types/node.
 */
declare const process: {
  argv: string[];
  env: Record<string, string>;
  exit: (code?: number) => void;
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

const ORACLE_BASE_URL =
  process.env["SENTINEL_ORACLE_URL"] ?? "http://localhost:3000";
const TARGET_TOKEN = process.argv[2] ?? "MOON";

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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAutonomousBotSimulation(): Promise<void> {
  console.log(
    `\n${COLORS.bold}${COLORS.cyan}==============================================================${COLORS.reset}`,
  );
  console.log(
    `${COLORS.bold}🤖 SENTINEL CLIENT TRADING BOT: A2A ORACLE INVOCATION${COLORS.reset}`,
  );
  console.log(
    `${COLORS.dim}Target DEX Pair: $${TARGET_TOKEN.toUpperCase()} / SOL | Network: Solana Devnet${COLORS.reset}`,
  );
  console.log(
    `${COLORS.cyan}==============================================================${COLORS.reset}\n`,
  );

  await sleep(600);
  console.log(
    `${COLORS.cyan}[STEP 1]${COLORS.reset} Bot detected liquidity pool for ${COLORS.bold}$${TARGET_TOKEN.toUpperCase()}${COLORS.reset}.`,
  );
  console.log(
    `         Triggering pre-execution risk check via Sentinel Oracle...`,
  );
  console.log(
    `         ${COLORS.dim}GET ${ORACLE_BASE_URL}/api/v1/oracle/risk?target=${TARGET_TOKEN}&type=TOKEN${COLORS.reset}\n`,
  );

  await sleep(800);

  // 1. Initial Unauthenticated Request
  let initialResponse: Response | undefined;
  try {
    initialResponse = await fetch(
      `${ORACLE_BASE_URL}/api/v1/oracle/risk?target=${TARGET_TOKEN}&type=TOKEN`,
    );
    if (initialResponse.status !== 402) {
      console.log(`Unexpected status code: ${initialResponse.status}`);
      const text = await initialResponse.text();
      console.log(text);
      return;
    }
  } catch (err) {
    console.error(
      `${COLORS.red}❌ Error: Could not connect to Sentinel Oracle at ${ORACLE_BASE_URL}.${COLORS.reset}`,
    );
    console.error(
      `   Please make sure the backend is running (e.g. 'bun run dev')\n`,
    );
    process.exit(1);
  }

  // 2. Handle HTTP 402 Challenge
  console.log(
    `${COLORS.yellow}[STEP 2]${COLORS.reset} ${COLORS.bold}HTTP 402 Payment Required received!${COLORS.reset}`,
  );
  if (!initialResponse) {
    throw new Error("initialResponse must be defined at this point");
  }
  const challengeBody =
    (await initialResponse.json()) as PaymentChallengePayload;
  const challenge = challengeBody.challenge;

  console.log(
    `         Protocol Header: ${COLORS.magenta}${initialResponse.headers.get("x-payment-protocol") ?? "moove-x402-v1"}${COLORS.reset}`,
  );
  console.log(
    `         Challenge ID:    ${COLORS.bold}${challenge.challengeId}${COLORS.reset}`,
  );
  console.log(
    `         Invoice Amount:  ${COLORS.bold}${challenge.amount} ${challenge.currency}${COLORS.reset} (${challenge.network})`,
  );
  console.log(
    `         Moove Recipient: ${COLORS.bold}${challenge.recipient}${COLORS.reset} (${challenge.recipientAddress.substring(0, 16)}...)`,
  );
  if (challenge.paymentUrl) {
    console.log(
      `         Payment URL:     ${COLORS.dim}${challenge.paymentUrl}${COLORS.reset}`,
    );
  }
  console.log("");

  await sleep(1000);

  // 3. Autonomous Micro-Payment Settlement via Moove
  console.log(
    `${COLORS.cyan}[STEP 3]${COLORS.reset} Bot automatically authorises micro-settlement via Moove rails...`,
  );
  const simulatedTxSignature = `5K9x${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}SolanaDevnetReceipt`;
  const payerWallet = "4vW2...AgentTraderVault";

  console.log(`         Signing payload with agent treasury keypair...`);
  await sleep(700);
  console.log(
    `         ${COLORS.green}✔ Transaction Settled on-chain!${COLORS.reset} Tx: ${COLORS.dim}${simulatedTxSignature}${COLORS.reset}\n`,
  );

  await sleep(600);

  // 4. Retry with X-PAYMENT Receipt Header
  console.log(
    `${COLORS.cyan}[STEP 4]${COLORS.reset} Re-submitting Oracle query with cryptographic proof in ${COLORS.bold}X-PAYMENT${COLORS.reset} header...`,
  );
  const receiptPayload = {
    challengeId: challenge.challengeId,
    txSignature: simulatedTxSignature,
    payerAddress: payerWallet,
  };

  const unlockedResponse = await fetch(
    `${ORACLE_BASE_URL}/api/v1/oracle/risk?target=${TARGET_TOKEN}&type=TOKEN`,
    {
      headers: {
        "X-PAYMENT": JSON.stringify(receiptPayload),
      },
    },
  );

  if (!unlockedResponse.ok) {
    console.error(
      `${COLORS.red}❌ Verification Failed: HTTP ${unlockedResponse.status}${COLORS.reset}`,
    );
    console.error(await unlockedResponse.text());
    return;
  }

  const result = (await unlockedResponse.json()) as OracleResponsePayload;
  console.log(
    `         ${COLORS.green}${COLORS.bold}HTTP 200 OK — Payment Verified! Unlocked Machine Risk Payload.${COLORS.reset}\n`,
  );

  await sleep(800);

  // 5. Synthesise Machine Verdict
  console.log(
    `${COLORS.cyan}[STEP 5]${COLORS.reset} ${COLORS.bold}ORACLE INTELLIGENCE REPORT FOR $${TARGET_TOKEN.toUpperCase()}:${COLORS.reset}`,
  );
  console.log(
    `         Verdict:          ${result.oracleVerdict.canExecute ? COLORS.green : COLORS.red}${COLORS.bold}${result.oracleVerdict.verdict}${COLORS.reset}`,
  );
  console.log(
    `         Risk Score:       ${result.oracleVerdict.riskScore >= 70 ? COLORS.red : COLORS.green}${COLORS.bold}${result.oracleVerdict.riskScore}/100${COLORS.reset}`,
  );
  console.log(
    `         Wash Volume:      $${result.graphTelemetry.washVolumeSol.toLocaleString()}`,
  );
  console.log(
    `         Sybil Clusters:   ${result.graphTelemetry.sybilCount} wallets`,
  );
  console.log(
    `         Graph Traversal:  ${result.graphTelemetry.queryDurationMs}ms across ${result.graphTelemetry.analyzedNodes} nodes`,
  );

  if (result.oracleVerdict.detectedAnomalies.length > 0) {
    console.log(
      `\n         ${COLORS.bold}Detected Graph Anomalies:${COLORS.reset}`,
    );
    for (const a of result.oracleVerdict.detectedAnomalies) {
      console.log(
        `          • [${COLORS.red}${a.severity}${COLORS.reset}] ${a.type}: ${a.details}`,
      );
    }
  }

  console.log(`\n         ${COLORS.bold}Semantic AI Context:${COLORS.reset}`);
  console.log(
    `         ${COLORS.dim}"${result.agentSemanticContext}"${COLORS.reset}\n`,
  );

  await sleep(500);

  // 6. Bot Action
  if (result.oracleVerdict.canExecute) {
    console.log(
      `${COLORS.green}${COLORS.bold}✅ [BOT DECISION]: SWAP APPROVED! Proceeding with swap execution for $${TARGET_TOKEN.toUpperCase()}.${COLORS.reset}\n`,
    );
  } else {
    console.log(
      `${COLORS.red}${COLORS.bold}🚨 [BOT DECISION]: SWAP ABORTED! Sentinel averted capital loss on fraud signature.${COLORS.reset}\n`,
    );
  }
}

runAutonomousBotSimulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
