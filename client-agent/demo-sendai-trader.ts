/**
 * 🤖 Sentinel × SendAI Demo Trader
 *
 * Demonstrates how an autonomous trading agent using SendAI's solana-agent-kit
 * integrates Sentinel's risk oracle as a pre-flight safety check before swaps.
 *
 * Usage:
 *   bun run client-agent/demo-sendai-trader.ts          # Check $MOON (risky)
 *   bun run client-agent/demo-sendai-trader.ts SAFE     # Check $SAFE (clean)
 *   bun run client-agent/demo-sendai-trader.ts --session # Buy session pass first
 */

import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAgentWallet, ensureWalletFunded } from "./src/wallet.js";
import {
  assessTokenRisk,
  buySessionPass,
  type SentinelPluginConfig,
} from "./src/plugins/sendai-sentinel.js";

const SOLANA_RPC_URL =
  process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";
const ORACLE_URL =
  process.env["SENTINEL_ORACLE_URL"] ?? "http://localhost:3000";

const C = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useSession = args.includes("--session") || args.includes("-s");
  const targetArg = args.find((a) => !a.startsWith("-"));
  const target = targetArg?.toUpperCase() ?? "MOON";

  console.log(
    `\n${C.bold}${C.cyan}════════════════════════════════════════════════════════════════════════${C.reset}`,
  );
  console.log(
    `${C.bold}🛡️  SENTINEL × SENDAI AUTONOMOUS TRADER DEMO${C.reset}`,
  );
  console.log(
    `${C.dim}Plugin: sendai-sentinel | Target: $${target} | Session Pass: ${useSession ? "YES" : "NO"}${C.reset}`,
  );
  console.log(
    `${C.cyan}════════════════════════════════════════════════════════════════════════${C.reset}\n`,
  );

  // ── Initialize Wallet ───────────────────────────────────────────────
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const wallet = getOrCreateAgentWallet();

  console.log(
    `${C.cyan}[SETUP]${C.reset} Agent Wallet:  ${C.bold}${wallet.publicKey}${C.reset}`,
  );
  console.log(
    `${C.cyan}[SETUP]${C.reset} Oracle:        ${C.dim}${ORACLE_URL}${C.reset}`,
  );

  const balance = await ensureWalletFunded(connection, wallet.keypair);
  console.log(
    `${C.cyan}[SETUP]${C.reset} Balance:       ${C.green}${balance.toFixed(4)} SOL${C.reset}\n`,
  );

  const pluginConfig: SentinelPluginConfig = {
    oracleUrl: ORACLE_URL,
    autoPayment: true,
  };

  // ── Optional: Buy Session Pass ──────────────────────────────────────
  if (useSession) {
    console.log(
      `${C.magenta}[SESSION PASS]${C.reset} Purchasing bulk session pass (0.01 SOL → 100 queries / 24h)...`,
    );

    try {
      const pass = await buySessionPass(
        connection,
        wallet.keypair,
        pluginConfig,
      );
      pluginConfig.sessionToken = pass.sessionToken;
      console.log(
        `${C.green}[SESSION PASS]${C.reset} ✔ Acquired! Pass ID: ${C.bold}${pass.passId}${C.reset}`,
      );
      console.log(
        `${C.dim}               Queries: ${pass.maxQueries} | Expires: ${pass.expiresAt}${C.reset}\n`,
      );
    } catch (err) {
      console.warn(
        `${C.yellow}[SESSION PASS]${C.reset} ⚠️ Could not acquire session pass: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.warn(
        `${C.dim}               Falling back to per-query x402 payment...${C.reset}\n`,
      );
    }
  }

  // ── Sentinel Risk Assessment ────────────────────────────────────────
  console.log(
    `${C.cyan}[SENTINEL PLUGIN]${C.reset} assessTokenRisk("${target}")...`,
  );
  console.log(
    `${C.dim}                  Negotiating x402 micro-payment autonomously...${C.reset}`,
  );

  try {
    const result = await assessTokenRisk(
      connection,
      wallet.keypair,
      { target, type: "TOKEN" },
      pluginConfig,
    );

    const v = result.oracleVerdict;
    const t = result.graphTelemetry;

    console.log(`\n${C.bold}[ORACLE INTELLIGENCE — $${target}]${C.reset}`);
    console.log(
      `  Verdict:       ${v.canExecute ? C.green : C.red}${C.bold}${v.verdict}${C.reset}`,
    );
    console.log(
      `  Risk Score:    ${v.riskScore >= 70 ? C.red : C.green}${C.bold}${v.riskScore}/100${C.reset} (Confidence: ${(v.confidence * 100).toFixed(0)}%)`,
    );
    console.log(
      `  Graph:         ${t.analyzedNodes} nodes, ${t.analyzedRelationships} edges in ${t.queryDurationMs}ms`,
    );
    if (t.washVolumeSol > 0) {
      console.log(
        `  Wash Volume:   ${C.red}${t.washVolumeSol.toLocaleString()} SOL in loops${C.reset}`,
      );
    }
    if (t.sybilCount > 0) {
      console.log(
        `  Sybil Bots:    ${C.red}${t.sybilCount} coordinated wallets${C.reset}`,
      );
    }
    console.log(
      `  AI Context:    ${C.dim}"${result.agentSemanticContext}"${C.reset}`,
    );

    // ── Trade Decision ──────────────────────────────────────────────
    if (v.canExecute) {
      console.log(
        `\n${C.green}${C.bold}✅ SAFE — Agent would execute Jupiter swap for $${target}${C.reset}`,
      );
    } else {
      console.log(
        `\n${C.red}${C.bold}🚨 BLOCKED — Capital protected from $${target} fraud${C.reset}`,
      );
      console.log(
        `  Threats: ${v.detectedAnomalies.map((a) => `[${a.type}]`).join(", ")}`,
      );
    }
  } catch (err) {
    console.error(
      `\n${C.red}❌ Assessment failed: ${err instanceof Error ? err.message : String(err)}${C.reset}`,
    );
    console.error(
      `${C.dim}Ensure Sentinel backend is running: bun run dev${C.reset}`,
    );
  }

  // ── Final Balance ─────────────────────────────────────────────────
  const finalLamports = await connection.getBalance(wallet.keypair.publicKey);
  console.log(
    `\n${C.dim}[STATUS] Final Balance: ${(finalLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL${C.reset}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
