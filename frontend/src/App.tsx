import { useState } from "react";
import {
  Shield,
  Sparkles,
  Database,
  Zap,
  Activity,
  Radio,
  ChevronRight,
  TerminalSquare,
} from "lucide-react";
import { AgentSimulator } from "./components/AgentSimulator.js";
import {
  RiskRadar,
  type OracleVerdictData,
  type GraphTelemetryData,
} from "./components/RiskRadar.js";
import {
  TelemetryStream,
  type LogEntry,
} from "./components/TelemetryStream.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Separator } from "./components/ui/separator.js";

const TICKER_ITEMS: string[] = [
  "CIRCULAR WASH LOOP // 6 HOPS",
  "SYBIL FARM // 14 WALLETS",
  "PEELING CHAIN // 9 HOPS TO CEX",
  "x402 SETTLED // 0.0003 SOL",
  "COGNODB TRAVERSAL // 42MS",
  "MOOVE RAILS // SOLANA MAINNET",
];

export function App(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "init-1",
      timestamp: new Date().toLocaleTimeString(),
      type: "INFO",
      message:
        "Sentinel Oracle Gateway initialized. x402 payment rails active.",
      meta: { protocol: "moove-x402-v1", engine: "CognoDB openCypher" },
    },
  ]);

  const [verdict, setVerdict] = useState<OracleVerdictData | null>(null);
  const [telemetry, setTelemetry] = useState<GraphTelemetryData | null>(null);
  const [semanticContext, setSemanticContext] = useState<string | null>(null);

  const handleAddLog = (entry: Omit<LogEntry, "id">): void => {
    const newEntry: LogEntry = {
      ...entry,
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    setLogs((prev) => [newEntry, ...prev].slice(0, 60));
  };

  const handleAssessmentUnlocked = (
    newVerdict: OracleVerdictData,
    newTelemetry: GraphTelemetryData,
    newContext: string,
  ): void => {
    setVerdict(newVerdict);
    setTelemetry(newTelemetry);
    setSemanticContext(newContext);
  };

  const handleSeedData = async (): Promise<void> => {
    handleAddLog({
      timestamp: new Date().toLocaleTimeString(),
      type: "INFO",
      message:
        "Triggering CognoDB test cluster seeding ($MOON wash loop & sybil cluster)...",
    });
    try {
      const res = await fetch("/api/v1/oracle/health");
      if (res.ok) {
        handleAddLog({
          timestamp: new Date().toLocaleTimeString(),
          type: "INFO",
          message:
            "Backend health confirmed. Demo dataset ready for traversal.",
        });
      } else {
        handleAddLog({
          timestamp: new Date().toLocaleTimeString(),
          type: "WARN",
          message: `Backend responded HTTP ${res.status}. Check oracle service.`,
        });
      }
    } catch {
      handleAddLog({
        timestamp: new Date().toLocaleTimeString(),
        type: "WARN",
        message:
          "Could not connect to backend. Please make sure backend is running on port 3000.",
      });
    }
  };

  const scrollToSimulator = (): void => {
    document
      .getElementById("simulator")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-void text-bone flex flex-col font-sans selection:bg-blaze selection:text-void relative overflow-hidden">
      {/* ambient background layers */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 cyber-grid-bg" />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[820px] rounded-full bg-blaze/15 blur-[140px]" />
        <div className="absolute top-1/3 -left-40 h-[380px] w-[380px] rounded-full bg-steel/25 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[280px] w-[520px] bg-gradient-to-t from-blaze/10 to-transparent blur-[80px]" />
        {/* vertical scan beam */}
        <div className="absolute inset-y-0 left-1/4 w-px bg-gradient-to-b from-transparent via-blaze/40 to-transparent animate-scan-drift opacity-40" />
      </div>

      {/* HUD header */}
      <header className="sticky top-0 z-50 border-b border-steel/30 bg-void/85 backdrop-blur-md">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-blaze to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 clip-cyber-sm bg-blaze flex items-center justify-center shadow-neon-orange">
              <Shield className="w-5 h-5 text-void" strokeWidth={2.5} />
              <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-bone animate-flicker" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1
                  data-text="SENTINEL"
                  className="glitch-hover font-display text-lg font-bold tracking-[0.28em] text-bone text-glow-bone"
                >
                  SENTINEL
                </h1>
                <Badge variant="default">x402 Risk Oracle</Badge>
              </div>
              <p className="text-[11px] font-mono text-bone/50 hidden sm:block tracking-wider">
                AGENT-TO-AGENT DEFI INTEL // MOOVE × COGNODB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 border border-steel/50 bg-steel/10 font-mono text-[11px] clip-cyber-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blaze opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blaze" />
              </span>
              <span className="text-bone/80 tracking-widest">
                MOOVE-X402-V1 // LIVE
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSeedData()}
            >
              <Database />
              <span className="hidden sm:inline">Check Nodes</span>
              <span className="sm:hidden">Nodes</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ticker */}
      <div className="relative z-10 border-b border-steel/25 bg-carbon/80 overflow-hidden">
        <div className="flex whitespace-nowrap animate-marquee py-1.5 font-mono text-[10px] tracking-[0.25em] text-bone/60">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className="flex shrink-0 items-center"
              aria-hidden={copy === 1}
            >
              {TICKER_ITEMS.map((item) => (
                <span key={`${copy}-${item}`} className="flex items-center">
                  <span className="px-4">
                    <span className="text-blaze mr-2">▮</span>
                    {item}
                  </span>
                  <span className="text-steel">//</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <main className="relative z-10 flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 w-full">
        {/* Hero */}
        <section className="relative overflow-hidden clip-cyber-panel border border-steel/40 bg-panel/90 cyber-scanlines cyber-noise">
          <div className="absolute inset-0 bg-gradient-to-r from-blaze/12 via-transparent to-steel/20" />
          <div className="absolute top-0 right-0 font-mono text-[10px] tracking-[0.3em] text-bone/40 px-4 py-2 border-l border-b border-steel/40 bg-void/60">
            SYS.HUD // ORACLE.SIM v1.0
          </div>
          <div className="relative grid lg:grid-cols-[1.4fr_1fr] gap-6 p-6 sm:p-10">
            <div className="space-y-4 max-w-2xl">
              <Badge variant="secondary">
                <Sparkles className="w-3 h-3" />
                Autonomous Agent Economy
              </Badge>
              <h2 className="font-display text-3xl sm:text-5xl font-bold leading-[1.02] tracking-tight">
                <span className="text-bone text-glow-bone">
                  PAY-PER-COMPUTE
                </span>
                <br />
                <span className="text-blaze text-glow-orange">RISK ORACLE</span>
                <span className="text-bone/90"> FOR AI AGENTS</span>
              </h2>
              <p className="font-mono text-[12px] sm:text-[13px] text-bone/65 leading-relaxed max-w-xl">
                {"//"} Bots can&apos;t pass KYC. Sentinel streams sub-second
                graph traversal of circular wash rings, Sybil farms &amp;
                peeling chains — monetized per-query via HTTP 402 micropayments
                settled on Moove.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button size="lg" onClick={scrollToSimulator}>
                  <Zap />
                  Run Bot Query — $0.0003
                  <ChevronRight />
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void handleSeedData()}
                >
                  <TerminalSquare />
                  Inspect Graph
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 font-mono text-[11px] text-bone/50 tracking-wider">
                <span>
                  <span className="text-blaze font-bold">HTTP 402</span>{" "}
                  CHALLENGE → SETTLE → UNLOCK
                </span>
                <span>
                  <span className="text-bone font-bold">0.0003 SOL</span> /
                  QUERY
                </span>
              </div>
            </div>

            {/* HUD stats */}
            <div className="grid grid-cols-3 lg:grid-cols-1 gap-3 content-center">
              {[
                { k: "AVG TRAVERSAL", v: "~42MS", icon: Activity },
                { k: "FEE / QUERY", v: "0.0003 SOL", icon: Zap },
                { k: "PROTOCOL", v: "X402-V1", icon: Radio },
              ].map((s) => (
                <div
                  key={s.k}
                  className="border border-steel/40 bg-void/70 clip-cyber-sm p-3 flex lg:flex-row flex-col lg:items-center gap-2 lg:gap-3"
                >
                  <div className="w-8 h-8 clip-cyber-sm bg-steel/25 border border-steel/60 flex items-center justify-center shrink-0">
                    <s.icon className="w-4 h-4 text-blaze" />
                  </div>
                  <div>
                    <div className="font-mono text-[9px] tracking-[0.25em] text-bone/45">
                      {s.k}
                    </div>
                    <div className="font-display text-sm font-bold tracking-widest text-bone">
                      {s.v}
                    </div>
                  </div>
                </div>
              ))}
              <div className="col-span-3 lg:col-span-1 border border-blaze/50 bg-blaze/10 clip-cyber-sm p-3">
                <div className="font-mono text-[10px] tracking-[0.25em] text-blaze">
                  ● THREAT MODELS: 03 ACTIVE
                </div>
                <div className="font-mono text-[10px] text-bone/60 mt-1 tracking-wider">
                  WASH-LOOP / SYBIL-FARM / PEEL-CHAIN
                </div>
              </div>
            </div>
          </div>
          <Separator />
          <div className="relative px-6 sm:px-10 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[10px] tracking-[0.22em] text-bone/45 bg-void/60">
            <span>RECIPIENT: SENTINEL.MOOVE</span>
            <span className="hidden sm:inline">NETWORK: SOLANA-MAINNET</span>
            <span className="hidden md:inline">ENGINE: COGNODB OPENCYPHER</span>
            <span className="ml-auto text-blaze">■ REC</span>
          </div>
        </section>

        {/* Simulator */}
        <div id="simulator" className="scroll-mt-24">
          <AgentSimulator
            onAddLog={handleAddLog}
            onAssessmentUnlocked={handleAssessmentUnlocked}
          />
        </div>

        {/* Dual analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <RiskRadar
            verdict={verdict}
            telemetry={telemetry}
            semanticContext={semanticContext}
          />
          <TelemetryStream logs={logs} onClear={() => setLogs([])} />
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-steel/30 bg-void/90">
        <div className="h-[2px] bg-gradient-to-r from-transparent via-steel to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 font-mono text-[11px] tracking-[0.2em] text-bone/40">
          <span>
            <span className="text-blaze font-bold">SENTINEL</span> ORACLE //
            BUILT FOR AUTONOMOUS WEB3 AGENTS
          </span>
          <div className="flex items-center gap-4">
            <span>MOOVE AGENTIC PAYMENTS</span>
            <span className="text-steel">◆</span>
            <span>COGNODB OPENCYPHER</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
