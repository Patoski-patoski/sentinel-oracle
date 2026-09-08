import React from "react";
import { Terminal, Trash2 } from "lucide-react";
import { Card, CardContent } from "./ui/card.js";
import { Badge } from "./ui/badge.js";
import { cn } from "@/lib/utils.js";

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "INFO" | "CHALLENGE_402" | "PAYMENT_SETTLED" | "UNLOCKED_200" | "WARN";
  message: string;
  meta?: Record<string, unknown>;
}

interface TelemetryStreamProps {
  logs: LogEntry[];
  onClear: () => void;
}

function typeBadgeVariant(
  type: LogEntry["type"],
): "secondary" | "warning" | "default" | "success" | "danger" {
  switch (type) {
    case "CHALLENGE_402":
      return "warning";
    case "PAYMENT_SETTLED":
      return "default";
    case "UNLOCKED_200":
      return "success";
    case "WARN":
      return "danger";
    default:
      return "secondary";
  }
}

export const TelemetryStream: React.FC<TelemetryStreamProps> = ({
  logs,
  onClear,
}) => {
  return (
    <Card className="flex flex-col h-[480px] lg:h-full lg:min-h-[480px] overflow-hidden cyber-scanlines">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-steel/30 bg-void/60">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 clip-cyber-sm bg-steel/25 border border-steel/60 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-blaze" />
          </span>
          <h3 className="font-display text-[12px] font-bold text-bone uppercase tracking-[0.22em]">
            M2M Telemetry Stream
          </h3>
          <Badge variant="success">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Rails
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline font-mono text-[10px] text-bone/40 tracking-widest">
            {logs.length} EVENTS
          </span>
          <button
            onClick={onClear}
            className="text-bone/40 hover:text-blaze transition-colors p-1.5 border border-transparent hover:border-blaze/40 clip-cyber-sm cursor-pointer"
            title="Clear stream"
            aria-label="Clear telemetry stream"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* terminal dots */}
      <div className="flex items-center gap-1.5 px-5 py-2 border-b border-steel/20 bg-carbon/60 font-mono text-[10px] tracking-[0.2em] text-bone/40">
        <span className="w-2.5 h-2.5 rounded-full bg-blaze/80" />
        <span className="w-2.5 h-2.5 rounded-full bg-steel" />
        <span className="w-2.5 h-2.5 rounded-full bg-bone/30" />
        <span className="ml-2">sentinel@oracle: ~/m2m-feed --tail</span>
        <span className="ml-auto hidden sm:inline text-blaze">● REC</span>
      </div>

      <CardContent className="flex-1 overflow-y-auto cyber-scroll space-y-2 p-4 font-mono text-[11px] bg-black/40">
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-bone/30 gap-2 py-12">
            <Terminal className="w-8 h-8" />
            <span className="tracking-[0.25em] text-[10px]">
              [NO ACTIVE TELEMETRY — TRIGGER A QUERY]
            </span>
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={cn(
                "p-2.5 clip-cyber-sm border bg-void/80 flex flex-col gap-1.5 transition-colors hover:border-blaze/40",
                log.type === "CHALLENGE_402" && "border-amber-500/30",
                log.type === "PAYMENT_SETTLED" && "border-blaze/40",
                log.type === "UNLOCKED_200" && "border-emerald-500/30",
                log.type === "WARN" && "border-[#ff2d55]/40",
                log.type === "INFO" && "border-steel/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-bone/35 text-[10px] tracking-wider">
                  {log.timestamp}
                </span>
                <Badge variant={typeBadgeVariant(log.type)}>{log.type}</Badge>
              </div>
              <div className="text-bone/85 break-all leading-relaxed">
                <span className="text-blaze mr-1.5">›</span>
                {log.message}
              </div>
              {log.meta !== undefined && (
                <div className="text-[10px] text-steel leading-relaxed bg-black/70 border border-steel/25 p-1.5 overflow-x-auto cyber-scroll">
                  {JSON.stringify(log.meta, null, 2)}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>

      <div className="px-5 py-2 border-t border-steel/25 bg-void/70 font-mono text-[9px] tracking-[0.25em] text-bone/35 flex justify-between">
        <span>PROTOCOL: MOOVE-X402-V1</span>
        <span>
          FEE: <span className="text-blaze">0.0003 SOL</span>
        </span>
      </div>
    </Card>
  );
};
