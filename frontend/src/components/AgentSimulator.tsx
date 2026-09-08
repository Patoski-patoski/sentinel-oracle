import React, { useState } from "react";
import {
  Play,
  Bot,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Coins,
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

const STEPS: Array<{ id: StepStatus; label: string; hint: string }> = [
  {
    id: "challenging",
    label: "01 // 402 Challenge",
    hint: "GATE ISSUES RECEIPT",
  },
  { id: "settling", label: "02 // Moove Settle", hint: "0.05 USDC STREAM" },
  { id: "unlocked", label: "03 // Risk Unlocked", hint: "GRAPH VERDICT" },
];

export const AgentSimulator: React.FC<AgentSimulatorProps> = ({
  onAddLog,
  onAssessmentUnlocked,
}) => {
  const [selectedToken, setSelectedToken] = useState("MOON");
  const [customToken, setCustomToken] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [stepStatus, setStepStatus] = useState<StepStatus>("idle");
  const [progress, setProgress] = useState(0);

  const activeTarget =
    customToken.trim() !== ""
      ? customToken.trim().toUpperCase()
      : selectedToken;

  const runSimulation = async (): Promise<void> => {
    setIsRunning(true);
    setStepStatus("challenging");
    setProgress(12);

    onAddLog({
      timestamp: new Date().toLocaleTimeString(),
      type: "INFO",
      message: `Autonomous Bot initiated swap check for $${activeTarget} on DEX liquidity pool.`,
    });

    try {
      const res = await fetch(
        `/api/v1/oracle/risk?target=${activeTarget}&type=TOKEN`,
      );

      if (res.status === 402) {
        const challengeData = (await res.json()) as {
          challenge: {
            challengeId: string;
            amount: string;
            currency: string;
            recipient: string;
          };
        };

        const challenge = challengeData.challenge;
        onAddLog({
          timestamp: new Date().toLocaleTimeString(),
          type: "CHALLENGE_402",
          message: `Sentinel Gate issued HTTP 402 Payment Required for Challenge [${challenge.challengeId}].`,
          meta: {
            amount: `${challenge.amount} ${challenge.currency}`,
            recipient: challenge.recipient,
            protocol: "moove-x402-v1",
          },
        });

        setStepStatus("settling");
        setProgress(48);
        await new Promise((r) => setTimeout(r, 900));

        const simulatedTx = `5K9x${Math.random().toString(36).substring(2, 9)}MooveDevnetReceipt`;
        onAddLog({
          timestamp: new Date().toLocaleTimeString(),
          type: "PAYMENT_SETTLED",
          message: `Bot streamed ${challenge.amount} ${challenge.currency} on Solana Devnet via Moove rails.`,
          meta: {
            txSignature: simulatedTx,
            challengeId: challenge.challengeId,
          },
        });

        setProgress(74);
        await new Promise((r) => setTimeout(r, 700));

        const receipt = {
          challengeId: challenge.challengeId,
          txSignature: simulatedTx,
          payerAddress: "4vW2...AgentTraderVault",
        };

        const unlockedRes = await fetch(
          `/api/v1/oracle/risk?target=${activeTarget}&type=TOKEN`,
          {
            headers: { "X-PAYMENT": JSON.stringify(receipt) },
          },
        );

        if (unlockedRes.ok) {
          const payload = (await unlockedRes.json()) as {
            oracleVerdict: OracleVerdictData;
            graphTelemetry: GraphTelemetryData;
            agentSemanticContext: string;
          };

          onAddLog({
            timestamp: new Date().toLocaleTimeString(),
            type: "UNLOCKED_200",
            message: `Sentinel verified receipt. Unlocked risk analysis for $${activeTarget} (${payload.oracleVerdict.verdict}).`,
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
        } else {
          onAddLog({
            timestamp: new Date().toLocaleTimeString(),
            type: "WARN",
            message: `Verification rejected: HTTP ${unlockedRes.status}`,
          });
          setStepStatus("idle");
          setProgress(0);
        }
      } else {
        onAddLog({
          timestamp: new Date().toLocaleTimeString(),
          type: "WARN",
          message: `Unexpected response status: HTTP ${res.status}`,
        });
        setStepStatus("idle");
        setProgress(0);
      }
    } catch (err) {
      onAddLog({
        timestamp: new Date().toLocaleTimeString(),
        type: "WARN",
        message: `Network error connecting to Sentinel backend: ${err instanceof Error ? err.message : String(err)}`,
      });
      setStepStatus("idle");
      setProgress(0);
    } finally {
      setIsRunning(false);
    }
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
                Simulating A2A Check...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run 1-Click Bot Query ($0.05)
              </>
            )}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">SOLANA-DEVNET</Badge>
          <Badge variant="bone">FEE: 0.05 USDC</Badge>
          <Badge variant="default">HEADER: X-PAYMENT</Badge>
          {stepStatus === "unlocked" && (
            <Badge variant="success">✓ LAST QUERY UNLOCKED</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
