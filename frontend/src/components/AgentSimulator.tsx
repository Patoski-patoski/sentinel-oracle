import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Bot,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Coins,
  ExternalLink,
  XCircle,
} from "lucide-react";
import type { LogEntry } from "./TelemetryStream.js";
import type { OracleVerdictData, GraphTelemetryData } from "./RiskRadar.js";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";
import { Input } from "./ui/input.js";
import { Progress } from "./ui/progress.js";
import { cn } from "@/lib/utils.js";

interface AgentSimulatorProps {
  onAddLog: (entry: Omit<LogEntry, "id">) => void;
  onAssessmentUnlocked: (
    verdict: OracleVerdictData,
    telemetry: GraphTelemetryData,
    semanticContext: string,
  ) => void;
}

type StepStatus = "idle" | "challenging" | "settling" | "unlocked";
type PaymentsMode = "mock" | "live";

interface Challenge {
  challengeId: string;
  amount: string;
  currency: string;
  recipient: string;
  paymentUrl?: string;
  linkId?: string;
}

interface PaymentStatusPayload {
  challengeId: string;
  linkId?: string;
  status: "pending" | "completed" | "expired" | "unknown";
  paymentUrl?: string;
  amount: string;
  currency: string;
}

interface UnlockedPayload {
  oracleVerdict: OracleVerdictData;
  graphTelemetry: GraphTelemetryData;
  agentSemanticContext: string;
}

const STEPS: Array<{ id: StepStatus; label: string; hint: string }> = [
  {
    id: "challenging",
    label: "01 // 402 Challenge",
    hint: "GATE ISSUES RECEIPT",
  },
  { id: "settling", label: "02 // Moove Settle", hint: "0.0003 SOL MAINNET" },
  { id: "unlocked", label: "03 // Risk Unlocked", hint: "GRAPH VERDICT" },
];

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 100; // ~5 minutes against a 15-minute challenge window

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const AgentSimulator: React.FC<AgentSimulatorProps> = ({
  onAddLog,
  onAssessmentUnlocked,
}) => {
  const [selectedToken, setSelectedToken] = useState("MOON");
  const [customToken, setCustomToken] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [stepStatus, setStepStatus] = useState<StepStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [paymentsMode, setPaymentsMode] = useState<PaymentsMode>("mock");
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(
    null,
  );
  const [pollCount, setPollCount] = useState(0);
  const cancelledRef = useRef(false);

  const activeTarget =
    customToken.trim() !== ""
      ? customToken.trim().toUpperCase()
      : selectedToken;

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/oracle/health")
      .then((res) => {
        if (!res.ok) return;
        return res.json() as Promise<{
          payments?: { mode?: PaymentsMode };
        }>;
      })
      .then((data) => {
        if (alive && data?.payments?.mode === "live") {
          setPaymentsMode("live");
        }
      })
      .catch(() => {
        // Health unreachable: stay in mock display until backend responds.
      });
    return () => {
      alive = false;
    };
  }, []);

  const log = (entry: Omit<LogEntry, "id">): void => onAddLog(entry);
  const now = (): string => new Date().toLocaleTimeString();

  const fail = (message: string): void => {
    log({ timestamp: now(), type: "WARN", message });
    setStepStatus("idle");
    setProgress(0);
    setActiveChallenge(null);
    setPollCount(0);
  };

  /** Shared: issue the 402 and return the live challenge. */
  const requestChallenge = async (
    target: string,
  ): Promise<Challenge | null> => {
    const res = await fetch(`/api/v1/oracle/risk?target=${target}&type=TOKEN`);
    if (res.status === 402) {
      const data = (await res.json()) as { challenge: Challenge };
      return data.challenge;
    }
    await fail(`Unexpected response status: HTTP ${res.status}`);
    return null;
  };

  /** Shared: retry /risk with a receipt and surface the unlocked verdict. */
  const unlockWithReceipt = async (
    target: string,
    receipt: Record<string, string>,
  ): Promise<boolean> => {
    const unlockedRes = await fetch(
      `/api/v1/oracle/risk?target=${target}&type=TOKEN`,
      { headers: { "X-PAYMENT": JSON.stringify(receipt) } },
    );

    if (unlockedRes.status === 202) {
      return false; // paid link not settled yet — caller keeps polling
    }
    if (!unlockedRes.ok) {
      await fail(`Verification rejected: HTTP ${unlockedRes.status}`);
      return false;
    }
    const payload = (await unlockedRes.json()) as UnlockedPayload;
    log({
      timestamp: now(),
      type: "UNLOCKED_200",
      message: `Sentinel verified settlement. Unlocked risk analysis for $${target} (${payload.oracleVerdict.verdict}).`,
      meta: {
        verdict: payload.oracleVerdict.verdict,
        riskScore: payload.oracleVerdict.riskScore,
        durationMs: payload.graphTelemetry.queryDurationMs,
      },
    });
    onAssessmentUnlocked(
      payload.oracleVerdict,
      payload.graphTelemetry,
      payload.agentSemanticContext,
    );
    setStepStatus("unlocked");
    setProgress(100);
    setActiveChallenge(null);
    setPollCount(0);
    return true;
  };

  /** Mock sandbox path: backend accepts a simulated receipt, no money moves. */
  const runMockSimulation = async (target: string): Promise<void> => {
    const challenge = await requestChallenge(target);
    if (!challenge) return;
    log({
      timestamp: now(),
      type: "CHALLENGE_402",
      message: `Sentinel Gate issued HTTP 402 Payment Required for Challenge [${challenge.challengeId}] (mock sandbox — no charge).`,
      meta: {
        amount: `${challenge.amount} ${challenge.currency}`,
        recipient: challenge.recipient,
        protocol: "moove-x402-v1",
      },
    });

    setStepStatus("settling");
    setProgress(48);
    await sleep(700);
    if (cancelledRef.current) return;

    const simulatedTx = `5K9x${Math.random().toString(36).substring(2, 9)}MockSandboxReceipt`;
    log({
      timestamp: now(),
      type: "PAYMENT_SETTLED",
      message: `Sandbox receipt minted locally (mock mode — 0 SOL moved).`,
      meta: { txSignature: simulatedTx, challengeId: challenge.challengeId },
    });
    setProgress(74);

    await unlockWithReceipt(target, {
      challengeId: challenge.challengeId,
      txSignature: simulatedTx,
      payerAddress: "4vW2...AgentTraderVault",
    });
  };

  /** Live path: payer completes the Moove checkout, we poll to completion. */
  const runLiveSettlement = async (target: string): Promise<void> => {
    const challenge = await requestChallenge(target);
    if (!challenge) return;
    if (!challenge.paymentUrl) {
      await fail(
        "Live challenge arrived without a paymentUrl — Moove link creation failed.",
      );
      return;
    }
    setActiveChallenge(challenge);
    log({
      timestamp: now(),
      type: "CHALLENGE_402",
      message: `Sentinel Gate issued HTTP 402 for Challenge [${challenge.challengeId}]. Complete the Moove checkout (${challenge.amount} ${challenge.currency} mainnet) to unlock.`,
      meta: {
        amount: `${challenge.amount} ${challenge.currency}`,
        recipient: challenge.recipient,
        paymentUrl: challenge.paymentUrl,
        linkId: challenge.linkId ?? "n/a",
        protocol: "moove-x402-v1",
      },
    });

    setStepStatus("settling");
    setProgress(30);
    window.open(challenge.paymentUrl, "_blank", "noopener,noreferrer");

    for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
      if (cancelledRef.current) return;
      setPollCount(poll);
      setProgress(30 + Math.min(40, Math.floor((poll / MAX_POLLS) * 40)));

      const params = new URLSearchParams();
      if (challenge.linkId) params.set("linkId", challenge.linkId);
      const statusRes = await fetch(
        `/api/v1/oracle/payment/${challenge.challengeId}/status?${params.toString()}`,
      );
      if (!statusRes.ok) {
        await fail(`Payment status lookup failed: HTTP ${statusRes.status}`);
        return;
      }
      const status = (await statusRes.json()) as PaymentStatusPayload;

      if (status.status === "completed") {
        log({
          timestamp: now(),
          type: "PAYMENT_SETTLED",
          message: `Moove reports link settled for Challenge [${challenge.challengeId}]. Submitting proof...`,
          meta: { linkId: challenge.linkId ?? "n/a" },
        });
        setProgress(74);
        const receipt: Record<string, string> = {
          challengeId: challenge.challengeId,
        };
        if (challenge.linkId) receipt["linkId"] = challenge.linkId;
        const done = await unlockWithReceipt(target, receipt);
        if (!done) {
          // Backend said 202 after status said completed — keep polling.
          continue;
        }
        return;
      }
      if (status.status === "expired" || status.status === "unknown") {
        await fail(
          `Payment link ${status.status}. Challenge [${challenge.challengeId}] can no longer settle — restart the query for a fresh link.`,
        );
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    await fail(
      "Timed out waiting for settlement (~5 min). Restart to mint a fresh link.",
    );
  };

  const runSimulation = async (): Promise<void> => {
    cancelledRef.current = false;
    setIsRunning(true);
    setStepStatus("challenging");
    setProgress(12);
    setPollCount(0);

    log({
      timestamp: now(),
      type: "INFO",
      message: `Autonomous Bot initiated swap check for $${activeTarget} on DEX liquidity pool.`,
    });

    try {
      if (paymentsMode === "live") {
        await runLiveSettlement(activeTarget);
      } else {
        await runMockSimulation(activeTarget);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        await fail(
          `Network error connecting to Sentinel backend: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } finally {
      setIsRunning(false);
    }
  };

  const cancelRun = (): void => {
    cancelledRef.current = true;
    setIsRunning(false);
    setStepStatus("idle");
    setProgress(0);
    setActiveChallenge(null);
    setPollCount(0);
    log({
      timestamp: now(),
      type: "WARN",
      message:
        "Operator cancelled the pending settlement wait. No charge was completed.",
    });
  };

  return (
    <Card className="cyber-scanlines overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-blaze via-blaze/40 to-transparent" />
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle>
            <span className="w-8 h-8 clip-cyber-sm bg-blaze flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-void" strokeWidth={2.5} />
            </span>
            AI Trading Agent Simulator
          </CardTitle>
          <CardDescription className="mt-1.5">
            {"//"} TEST AUTONOMOUS A2A 402 CHALLENGE → MOOVE SETTLEMENT →
            COGNODB EVALUATION
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setSelectedToken("MOON");
              setCustomToken("");
            }}
            className={cn(
              "px-3 py-2 font-mono text-[11px] font-bold tracking-[0.15em] transition-all clip-cyber-sm border cursor-pointer flex items-center gap-1.5",
              selectedToken === "MOON" && customToken === ""
                ? "bg-blaze text-void border-blaze shadow-neon-orange"
                : "bg-void text-bone/60 border-steel/50 hover:border-blaze/60 hover:text-bone",
            )}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            $MOON // WASH LOOP
          </button>
          <button
            onClick={() => {
              setSelectedToken("SAFE");
              setCustomToken("");
            }}
            className={cn(
              "px-3 py-2 font-mono text-[11px] font-bold tracking-[0.15em] transition-all clip-cyber-sm border cursor-pointer flex items-center gap-1.5",
              selectedToken === "SAFE" && customToken === ""
                ? "bg-bone text-void border-bone shadow-[0_0_18px_rgba(233,227,223,0.35)]"
                : "bg-void text-bone/60 border-steel/50 hover:border-bone/60 hover:text-bone",
            )}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            $SAFE // ORGANIC
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* step flow */}
        <div className="grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
          {STEPS.map((step, i) => {
            const order: StepStatus[] = ["challenging", "settling", "unlocked"];
            const activeIdx = order.indexOf(stepStatus);
            const isActive = stepStatus === step.id;
            const isDone = activeIdx > i || stepStatus === "unlocked";
            return (
              <React.Fragment key={step.id}>
                <div
                  className={cn(
                    "border clip-cyber-sm px-3 py-2.5 transition-all",
                    isActive
                      ? "border-blaze bg-blaze/15 shadow-neon-orange"
                      : isDone
                        ? "border-bone/50 bg-bone/10"
                        : "border-steel/40 bg-void/60",
                  )}
                >
                  <div
                    className={cn(
                      "font-mono text-[11px] font-bold tracking-[0.18em]",
                      isActive
                        ? "text-blaze"
                        : isDone
                          ? "text-bone"
                          : "text-bone/45",
                    )}
                  >
                    {isActive && isRunning ? "◉ " : isDone ? "✓ " : "○ "}
                    {step.label}
                  </div>
                  <div className="font-mono text-[9px] tracking-[0.2em] text-bone/40 mt-0.5">
                    {step.hint}
                  </div>
                </div>
                {i < 2 && (
                  <div className="hidden sm:flex items-center justify-center px-1">
                    <ArrowRight className="w-4 h-4 text-steel" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        <Progress value={progress} className="h-1.5" />

        {/* live payment panel */}
        {activeChallenge?.paymentUrl && stepStatus === "settling" && (
          <div className="border border-blaze/50 bg-blaze/10 clip-cyber-sm p-4 space-y-2">
            <div className="font-mono text-[11px] font-bold tracking-[0.22em] text-blaze">
              ◉ AWAITING PAYMENT — POLL {pollCount}/{MAX_POLLS}
            </div>
            <p className="font-mono text-[11px] text-bone/70 leading-relaxed">
              Complete the Moove checkout for{" "}
              <span className="text-bone font-bold">
                {activeChallenge.amount} {activeChallenge.currency}
              </span>{" "}
              (challenge{" "}
              <span className="text-blaze">{activeChallenge.challengeId}</span>
              ). This panel unlocks automatically once the link settles.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href={activeChallenge.paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-blaze text-void font-mono text-[11px] font-bold tracking-[0.18em] px-4 py-2 clip-cyber-sm hover:bg-bone transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                OPEN MOOVE CHECKOUT
              </a>
              <Button variant="secondary" size="sm" onClick={cancelRun}>
                <XCircle />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* controls */}
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-blaze text-sm font-bold">
                $
              </span>
              <Input
                value={customToken}
                onChange={(e) =>
                  setCustomToken(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 16),
                  )
                }
                placeholder={`CUSTOM TARGET — e.g. BONK (active: ${activeTarget})`}
                className="pl-8 uppercase"
                maxLength={16}
                aria-label="Custom token target"
              />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border border-steel/40 bg-void/60 clip-cyber-sm font-mono text-[11px] tracking-wider text-bone/60 whitespace-nowrap">
              <Coins className="w-3.5 h-3.5 text-blaze" />
              TARGET:{" "}
              <span className="text-bone font-bold">${activeTarget}</span>
            </div>
          </div>
          <Button
            onClick={() => void runSimulation()}
            disabled={isRunning}
            size="lg"
            className={cn(isRunning && "animate-pulse-glow")}
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {paymentsMode === "live"
                  ? "Awaiting Payment..."
                  : "Simulating A2A Check..."}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                {paymentsMode === "live"
                  ? "Run Bot Query — Pay $0.0003"
                  : "Run 1-Click Bot Query ($0.0003)"}
              </>
            )}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">SOLANA-MAINNET</Badge>
          <Badge variant="bone">FEE: 0.0003 SOL</Badge>
          <Badge variant="default">HEADER: X-PAYMENT</Badge>
          {paymentsMode === "live" ? (
            <Badge variant="warning">● LIVE MAINNET SETTLEMENT</Badge>
          ) : (
            <Badge variant="secondary">○ MOCK SANDBOX — NO CHARGE</Badge>
          )}
          {stepStatus === "unlocked" && (
            <Badge variant="success">✓ LAST QUERY UNLOCKED</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
