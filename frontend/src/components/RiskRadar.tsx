import React from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Network,
  Split,
  Clock,
  BrainCircuit,
  TriangleAlert,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card.js";
import { Badge } from "./ui/badge.js";
import { Progress } from "./ui/progress.js";
import { Separator } from "./ui/separator.js";
import { cn } from "@/lib/utils.js";

export interface GraphTelemetryData {
  analyzedNodes: number;
  analyzedRelationships: number;
  sybilCount: number;
  washVolumeSol: number;
  peelingHopsToCex: number;
  queryDurationMs: number;
  isSimulatedFallback?: boolean;
}

export interface OracleVerdictData {
  canExecute: boolean;
  verdict: string;
  riskScore: number;
  target: string;
  confidence: number;
  detectedAnomalies: Array<{ type: string; severity: string; details: string }>;
}

interface RiskRadarProps {
  verdict: OracleVerdictData | null;
  telemetry: GraphTelemetryData | null;
  semanticContext: string | null;
}

export const RiskRadar: React.FC<RiskRadarProps> = ({
  verdict,
  telemetry,
  semanticContext,
}) => {
  if (!verdict || !telemetry) {
    return (
      <Card className="min-h-[420px] flex flex-col items-center justify-center text-center p-8 cyber-scanlines">
        <div className="w-16 h-16 clip-cyber bg-steel/20 border border-steel/60 flex items-center justify-center mb-4">
          <Activity className="w-8 h-8 text-steel animate-pulse" />
        </div>
        <h3 className="font-display text-base font-bold uppercase tracking-[0.25em] text-bone">
          Awaiting Oracle Query
        </h3>
        <p className="font-mono text-[11px] text-bone/50 max-w-xs mt-2 leading-relaxed tracking-wider">
          {"//"} TRIGGER AN AUTONOMOUS RISK QUERY ABOVE TO INSPECT GRAPH
          TRAVERSAL + AI VERDICT
        </p>
        <div className="flex gap-2 mt-4">
          <Badge variant="secondary">WASH-LOOP: STANDBY</Badge>
          <Badge variant="secondary">SYBIL: STANDBY</Badge>
        </div>
      </Card>
    );
  }

  const isHighRisk = verdict.riskScore >= 70;
  const isModerateRisk = verdict.riskScore >= 40 && verdict.riskScore < 70;

  const metrics = [
    {
      icon: Network,
      label: "WASH LOOPS",
      value: `$${telemetry.washVolumeSol.toLocaleString()}`,
      sub: "CYCLING VOLUME",
      accent: "text-blaze",
    },
    {
      icon: ShieldAlert,
      label: "SYBIL BOTS",
      value: `${telemetry.sybilCount} WAL`,
      sub: "COORDINATED CLUSTER",
      accent: "text-bone",
    },
    {
      icon: Split,
      label: "PEELING CHAIN",
      value: `${telemetry.peelingHopsToCex} HOPS`,
      sub: "TO CEX DEPOSIT",
      accent: "text-steel",
    },
    {
      icon: Clock,
      label: "LATENCY",
      value: `${telemetry.queryDurationMs}MS`,
      sub: `${telemetry.analyzedNodes} NODES`,
      accent: "text-bone/80",
    },
  ];

  return (
    <Card className="cyber-scanlines overflow-hidden">
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-[2px]",
          verdict.canExecute
            ? "bg-gradient-to-r from-bone via-bone/40 to-transparent"
            : "bg-gradient-to-r from-blaze via-[#ff2d55] to-transparent",
        )}
      />
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "p-3 clip-cyber-sm border shrink-0",
                verdict.canExecute
                  ? "bg-bone/10 border-bone/40 text-bone"
                  : "bg-blaze/15 border-blaze/60 text-blaze shadow-neon-orange animate-pulse-glow",
              )}
            >
              {verdict.canExecute ? (
                <ShieldCheck className="w-7 h-7" />
              ) : (
                <ShieldAlert className="w-7 h-7" />
              )}
            </div>
            <div>
              <CardTitle className="!text-lg">
                ${verdict.target}
                <Badge variant={verdict.canExecute ? "success" : "danger"}>
                  {verdict.verdict}
                </Badge>
              </CardTitle>
              <p className="font-mono text-[11px] text-bone/50 mt-1 tracking-wider">
                CONF: {(verdict.confidence * 100).toFixed(0)}% // ENGINE:
                COGNODB TRAVERSAL
                {telemetry.isSimulatedFallback === true && " // SIM-FALLBACK"}
              </p>
            </div>
          </div>

          <div
            className={cn(
              "px-4 py-2 border clip-cyber-sm text-center min-w-[130px]",
              isHighRisk
                ? "border-[#ff2d55]/60 bg-[#ff2d55]/10 text-[#ff6b8a]"
                : isModerateRisk
                  ? "border-blaze/60 bg-blaze/10 text-blaze"
                  : "border-bone/40 bg-bone/10 text-bone",
            )}
          >
            <div className="font-mono text-[9px] tracking-[0.3em] opacity-80">
              RISK SCORE
            </div>
            <div className="font-display text-2xl font-bold">
              {verdict.riskScore}/100
            </div>
          </div>
        </div>
        <div className="pt-3">
          <div className="flex justify-between font-mono text-[10px] tracking-[0.25em] text-bone/45 mb-1.5">
            <span>THREAT METER</span>
            <span>
              {isHighRisk
                ? "CRITICAL"
                : isModerateRisk
                  ? "ELEVATED"
                  : "NOMINAL"}
            </span>
          </div>
          <Progress
            value={verdict.riskScore}
            indicatorClassName={cn(
              isHighRisk
                ? "!from-[#ff2d55] !via-blaze !to-blaze"
                : isModerateRisk
                  ? "!from-steel !via-blaze !to-blaze"
                  : "!from-steel !via-bone !to-bone !shadow-[0_0_12px_rgba(233,227,223,0.5)]",
            )}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="bg-void/70 border border-steel/40 clip-cyber-sm p-3 hover:border-blaze/50 transition-colors group"
            >
              <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-bone/50 mb-1.5">
                <m.icon
                  className={cn(
                    "w-3.5 h-3.5",
                    m.accent,
                    "group-hover:text-blaze",
                  )}
                />
                {m.label}
              </div>
              <div className="font-display text-base font-bold text-bone">
                {m.value}
              </div>
              <div className="font-mono text-[9px] tracking-[0.2em] text-bone/35 mt-0.5">
                {m.sub} // {telemetry.analyzedRelationships} RELS
              </div>
            </div>
          ))}
        </div>

        {semanticContext !== null && semanticContext !== "" && (
          <div className="border border-steel/50 bg-steel/10 clip-cyber-sm p-3.5 relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-[3px] bg-blaze shadow-neon-orange" />
            <div className="font-mono text-[10px] font-bold text-blaze tracking-[0.3em] mb-1.5 flex items-center gap-1.5">
              <BrainCircuit className="w-3.5 h-3.5" />
              LLM RISK DIRECTIVE
            </div>
            <p className="font-mono text-[11px] text-bone/80 leading-relaxed">
              {semanticContext}
            </p>
          </div>
        )}

        {verdict.detectedAnomalies.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <div className="font-mono text-[10px] font-bold text-bone/50 tracking-[0.3em] flex items-center gap-1.5 pt-1">
              <TriangleAlert className="w-3.5 h-3.5 text-blaze" />
              FLAGGED FRAUD SIGNATURES ({verdict.detectedAnomalies.length})
            </div>
            <div className="space-y-1.5">
              {verdict.detectedAnomalies.map((anomaly, idx) => (
                <div
                  key={`${anomaly.type}-${idx}`}
                  className="bg-void/70 border border-steel/35 clip-cyber-sm p-2.5 flex items-start gap-2.5"
                >
                  <Badge
                    variant={
                      anomaly.severity === "CRITICAL" ? "danger" : "warning"
                    }
                  >
                    {anomaly.severity}
                  </Badge>
                  <div className="font-mono text-[11px] leading-relaxed">
                    <span className="font-bold text-bone">
                      {anomaly.type}:{" "}
                    </span>
                    <span className="text-bone/60">{anomaly.details}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
