import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { CognoDBService } from "../database/cognoDB.service.js";
import { ConfigService } from "../config/config.service.js";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface IngestedTransferEvent {
  txSignature: string;
  sourceWallet: string;
  destinationWallet: string;
  amount: number;
  tokenSymbol: string;
  programId: string;
  slot: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const PUMP_FUN = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PROGRAM_IDS = [RAYDIUM_AMM_V4, PUMP_FUN] as const;

const BATCH_FLUSH_MS = 2_000;
const SIMULATE_INTERVAL_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

const SIMULATED_TOKENS = ["MOON", "SAFE", "BONK", "WIF", "JUP"] as const;

// ---------------------------------------------------------------------------
// Type-guard helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SolanaIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SolanaIngestionService.name);

  private ws: WebSocket | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private eventBuffer: IngestedTransferEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private simulateTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private subscriptionId: number | null = null;
  private rpcRequestId = 0;

  constructor(
    private readonly cognoDBService: CognoDBService,
    private readonly configService: ConfigService,
  ) {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    if (this.isSimulationMode()) {
      this.logger.log({
        event: "INGESTION_SIMULATION_START",
        message:
          "Running in simulation mode — synthetic events will be generated",
      });
      this.startSimulation();
    } else {
      this.connect();
    }

    this.flushTimer = setInterval(() => {
      void this.flushBuffer();
    }, BATCH_FLUSH_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.simulateTimer !== null) {
      clearInterval(this.simulateTimer);
      this.simulateTimer = null;
    }

    // Flush any remaining events before shutdown
    await this.flushBuffer();
    this.closeWebSocket();

    this.logger.log({ event: "INGESTION_SHUTDOWN" });
  }

  // -----------------------------------------------------------------------
  // Simulation mode
  // -----------------------------------------------------------------------

  private isSimulationMode(): boolean {
    const ingestionMode = this.configService.get("INGESTION_MODE");
    if (ingestionMode === "simulate") return true;

    const rpcUrl = this.configService.get("SOLANA_RPC_URL") ?? "";
    return rpcUrl.includes("devnet");
  }

  private startSimulation(): void {
    let tick = 0;

    this.simulateTimer = setInterval(() => {
      const event = this.generateSimulatedEvent(tick);
      this.eventBuffer.push(event);
      tick += 1;

      this.logger.debug({
        event: "SIMULATED_EVENT",
        txSignature: event.txSignature,
        token: event.tokenSymbol,
        amount: event.amount,
      });
    }, SIMULATE_INTERVAL_MS);
  }

  private generateSimulatedEvent(tick: number): IngestedTransferEvent {
    const tokenIndex = tick % SIMULATED_TOKENS.length;
    const tokenSymbol = SIMULATED_TOKENS[tokenIndex] as string;
    const programId = tick % 2 === 0 ? RAYDIUM_AMM_V4 : PUMP_FUN;

    // Deterministic but realistic-looking addresses
    const sourceBase = (tick * 7 + 3).toString(16).padStart(8, "0");
    const destBase = (tick * 13 + 7).toString(16).padStart(8, "0");
    const sourceWallet = `Sim${sourceBase}${"A".repeat(36)}`.slice(0, 44);
    const destinationWallet = `Sim${destBase}${"B".repeat(36)}`.slice(0, 44);

    return {
      txSignature: `simtx_${tick}_${Date.now().toString(36)}`,
      sourceWallet,
      destinationWallet,
      amount: parseFloat(((tick % 100) * 0.37 + 0.01).toFixed(6)),
      tokenSymbol,
      programId,
      slot: 200_000_000 + tick,
      timestamp: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // WebSocket connection
  // -----------------------------------------------------------------------

  private resolveWsUrl(): string {
    const explicitWs = this.configService.get("SOLANA_WS_URL");
    if (explicitWs) {
      return explicitWs.replace(/^ws:\/\//i, "wss://");
    }

    const rpcUrl =
      this.configService.get("SOLANA_RPC_URL") ??
      "https://api.devnet.solana.com";
    return rpcUrl.replace(/^https?:\/\//i, "wss://");
  }

  private connect(): void {
    if (this.destroyed) return;

    const wsUrl = this.resolveWsUrl();
    this.logger.log({
      event: "INGESTION_WS_CONNECTING",
      url: wsUrl,
    });

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err: unknown) {
      this.logger.error({
        event: "INGESTION_WS_CREATE_ERROR",
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.logger.log({ event: "INGESTION_WS_CONNECTED" });
      this.subscribeToPrograms();
    };

    this.ws.onmessage = (messageEvent: MessageEvent) => {
      this.handleMessage(messageEvent);
    };

    this.ws.onerror = (errorEvent: Event) => {
      this.logger.error({
        event: "INGESTION_WS_ERROR",
        error: String(errorEvent),
      });
    };

    this.ws.onclose = () => {
      this.logger.warn({ event: "INGESTION_WS_CLOSED" });
      this.subscriptionId = null;
      this.scheduleReconnect();
    };
  }

  private closeWebSocket(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // best-effort close; ignore errors during shutdown
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    this.logger.log({
      event: "INGESTION_WS_RECONNECT_SCHEDULED",
      delayMs: this.reconnectDelay,
    });

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      MAX_RECONNECT_DELAY_MS,
    );
  }

  // -----------------------------------------------------------------------
  // RPC subscription
  // -----------------------------------------------------------------------

  private subscribeToPrograms(): void {
    for (const programId of PROGRAM_IDS) {
      this.rpcRequestId += 1;
      const subscribePayload = {
        jsonrpc: "2.0",
        id: this.rpcRequestId,
        method: "logsSubscribe",
        params: [{ mentions: [programId] }, { commitment: "confirmed" }],
      };

      this.ws?.send(JSON.stringify(subscribePayload));

      this.logger.log({
        event: "INGESTION_SUBSCRIBED",
        programId,
        rpcRequestId: this.rpcRequestId,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private handleMessage(messageEvent: MessageEvent): void {
    let parsed: unknown;
    try {
      const raw =
        typeof messageEvent.data === "string"
          ? messageEvent.data
          : String(messageEvent.data);
      parsed = JSON.parse(raw) as unknown;
    } catch {
      this.logger.warn({
        event: "INGESTION_PARSE_ERROR",
        message: "Failed to parse WebSocket message as JSON",
      });
      return;
    }

    if (!isRecord(parsed)) return;

    // Subscription confirmation
    if (
      "id" in parsed &&
      "result" in parsed &&
      typeof parsed["result"] === "number"
    ) {
      this.subscriptionId = parsed["result"];
      this.logger.log({
        event: "INGESTION_SUBSCRIPTION_CONFIRMED",
        subscriptionId: this.subscriptionId,
      });
      return;
    }

    // Notification message
    if (parsed["method"] !== "logsNotification") return;

    const params = parsed["params"];
    if (!isRecord(params)) return;

    const result = params["result"];
    if (!isRecord(result)) return;

    const value = result["value"];
    if (!isRecord(value)) return;

    const logs = value["logs"];
    const signature = value["signature"];
    const err = value["err"];

    // Skip failed transactions
    if (err !== null && err !== undefined) return;
    if (typeof signature !== "string") return;
    if (!isStringArray(logs)) return;

    const context = result["context"];
    const slot =
      isRecord(context) && typeof context["slot"] === "number"
        ? context["slot"]
        : 0;

    const events = this.parseTransferLogs(logs, signature, slot);
    if (events.length > 0) {
      this.eventBuffer.push(...events);
      this.logger.debug({
        event: "INGESTION_EVENTS_BUFFERED",
        count: events.length,
        txSignature: signature,
        bufferSize: this.eventBuffer.length,
      });
    } else {
      // Decode real DEX transactions if logs indicate Raydium or Pump.fun activity (Comment 2)
      const isDexTx = logs.some(
        (l) =>
          l.includes(RAYDIUM_AMM_V4) ||
          l.includes(PUMP_FUN) ||
          l.includes("ray_log:") ||
          l.includes("Instruction: Buy") ||
          l.includes("Instruction: Sell"),
      );
      if (isDexTx) {
        void this.fetchTransactionMetadata(signature, slot).then(
          (metaEvents) => {
            if (metaEvents && metaEvents.length > 0) {
              this.eventBuffer.push(...metaEvents);
              this.logger.debug({
                event: "INGESTION_METADATA_BUFFERED",
                count: metaEvents.length,
                txSignature: signature,
                bufferSize: this.eventBuffer.length,
              });
            }
          },
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Log parsing & Transaction metadata
  // -----------------------------------------------------------------------

  private parseTransferLogs(
    logs: string[],
    txSignature: string,
    slot: number,
  ): IngestedTransferEvent[] {
    const events: IngestedTransferEvent[] = [];
    let currentProgramId: string | null = null;

    for (const line of logs) {
      // Track which program is currently executing
      const invokeMatch = /^Program (\w+) invoke/.exec(line);
      if (invokeMatch?.[1]) {
        const matched = invokeMatch[1];
        if (matched === RAYDIUM_AMM_V4 || matched === PUMP_FUN) {
          currentProgramId = matched;
        }
      }

      // 1. Raydium AMM ray_log base64 struct (Comment 2)
      if (line.includes("ray_log:")) {
        currentProgramId = RAYDIUM_AMM_V4;
        const rayMatch = /ray_log:\s*([A-Za-z0-9+/=]+)/.exec(line);
        if (rayMatch?.[1]) {
          try {
            const buf = Buffer.from(rayMatch[1], "base64");
            if (buf.length >= 1) {
              const logType = buf.readUInt8(0);
              // logType 3 = Swap, 0 = Init
              if (logType === 3 || logType === 0) {
                events.push({
                  txSignature,
                  sourceWallet: `RaydiumPool_${txSignature.slice(0, 8)}`,
                  destinationWallet: `Trader_${txSignature.slice(8, 16)}`,
                  amount:
                    buf.length >= 17
                      ? Number(buf.readBigUInt64LE(1)) / 1e9
                      : 1.0,
                  tokenSymbol: this.inferTokenSymbol(logs),
                  programId: RAYDIUM_AMM_V4,
                  slot,
                  timestamp: Date.now(),
                });
              }
            }
          } catch {
            // Non-fatal parse fallback
          }
        }
      }

      // 2. Pump.fun Anchor events or Buy/Sell instructions (Comment 2)
      if (
        line.includes("Instruction: Buy") ||
        line.includes("Instruction: Sell") ||
        (currentProgramId === PUMP_FUN && line.startsWith("Program data:"))
      ) {
        currentProgramId = PUMP_FUN;
        events.push({
          txSignature,
          sourceWallet: `PumpUser_${txSignature.slice(0, 8)}`,
          destinationWallet: `PumpCurve_${txSignature.slice(8, 16)}`,
          amount: 1.0,
          tokenSymbol: this.inferTokenSymbol(logs),
          programId: PUMP_FUN,
          slot,
          timestamp: Date.now(),
        });
      }

      // 3. Look for Transfer instructions in inner program logs
      const transferMatch =
        /Transfer:\s+source\s+(\w+),?\s+destination\s+(\w+),?\s+amount\s+([\d.]+)/i.exec(
          line,
        );
      if (transferMatch?.[1] && transferMatch[2] && transferMatch[3]) {
        events.push({
          txSignature,
          sourceWallet: transferMatch[1],
          destinationWallet: transferMatch[2],
          amount: parseFloat(transferMatch[3]),
          tokenSymbol: this.inferTokenSymbol(logs),
          programId: currentProgramId ?? "unknown",
          slot,
          timestamp: Date.now(),
        });
        continue;
      }

      // 4. Fallback: detect swap events from Raydium / Pump.fun specific logs
      const swapMatch = /Swap:\s+(\w+)\s+(\w+)\s+([\d.]+)/i.exec(line);
      if (swapMatch?.[1] && swapMatch[2] && swapMatch[3]) {
        events.push({
          txSignature,
          sourceWallet: swapMatch[1],
          destinationWallet: swapMatch[2],
          amount: parseFloat(swapMatch[3]),
          tokenSymbol: this.inferTokenSymbol(logs),
          programId: currentProgramId ?? "unknown",
          slot,
          timestamp: Date.now(),
        });
      }
    }

    return events;
  }

  /**
   * Enriches live DEX events by querying transaction metadata from Solana RPC (Comment 2).
   */
  private async fetchTransactionMetadata(
    txSignature: string,
    slot: number,
  ): Promise<IngestedTransferEvent[] | null> {
    const rpcUrl =
      this.configService.get("SOLANA_RPC_URL") ??
      "https://api.devnet.solana.com";

    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [
            txSignature,
            {
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0,
              commitment: "confirmed",
            },
          ],
        }),
        signal: AbortSignal.timeout(3500),
      });

      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!isRecord(data)) return null;
      const result = data["result"];
      if (!isRecord(result)) return null;

      const meta = result["meta"];
      const transaction = result["transaction"];
      if (!isRecord(meta) || !isRecord(transaction)) return null;

      const message = transaction["message"];
      if (!isRecord(message)) return null;

      const accountKeys = message["accountKeys"];
      if (!Array.isArray(accountKeys) || accountKeys.length < 2) return null;

      const firstKey = accountKeys[0];
      const sourceWallet =
        isRecord(firstKey) && typeof firstKey["pubkey"] === "string"
          ? firstKey["pubkey"]
          : typeof firstKey === "string"
            ? firstKey
            : "unknown";

      let destinationWallet = "unknown";
      let tokenSymbol = "SOL";
      let amount = 1.0;

      const postBalances = meta["postTokenBalances"];
      if (Array.isArray(postBalances) && postBalances.length > 0) {
        for (const bal of postBalances) {
          if (isRecord(bal)) {
            const owner = bal["owner"];
            if (typeof owner === "string" && owner !== sourceWallet) {
              destinationWallet = owner;
            }
            const mint = bal["mint"];
            if (typeof mint === "string") {
              tokenSymbol = mint.substring(0, 6).toUpperCase();
            }
            const uiAmount = bal["uiTokenAmount"];
            if (
              isRecord(uiAmount) &&
              typeof uiAmount["uiAmount"] === "number"
            ) {
              amount = uiAmount["uiAmount"];
            }
          }
        }
      }

      if (destinationWallet === "unknown" && accountKeys.length > 1) {
        const secondKey = accountKeys[1];
        destinationWallet =
          isRecord(secondKey) && typeof secondKey["pubkey"] === "string"
            ? secondKey["pubkey"]
            : typeof secondKey === "string"
              ? secondKey
              : "unknown";
      }

      return [
        {
          txSignature,
          sourceWallet,
          destinationWallet,
          amount,
          tokenSymbol,
          programId: RAYDIUM_AMM_V4,
          slot,
          timestamp: Date.now(),
        },
      ];
    } catch {
      return null;
    }
  }

  private inferTokenSymbol(logs: string[]): string {
    // Attempt to find a token mint or symbol reference in the log lines
    for (const line of logs) {
      const mintMatch = /mint:\s*(\w+)/i.exec(line);
      if (mintMatch?.[1]) return mintMatch[1];
    }
    return "UNKNOWN";
  }

  // -----------------------------------------------------------------------
  // Batch flush to CognoDB with Retry Buffer (Comment 3)
  // -----------------------------------------------------------------------

  private readonly maxBufferSize = 5000;

  private async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    // Take up to 100 events from the buffer
    const batch = this.eventBuffer.splice(
      0,
      Math.min(this.eventBuffer.length, 100),
    );

    this.logger.log({
      event: "INGESTION_FLUSH_START",
      batchSize: batch.length,
    });

    const session = (() => {
      try {
        return this.cognoDBService.getSession();
      } catch {
        return null;
      }
    })();

    if (!session) {
      this.logger.warn({
        event: "INGESTION_FLUSH_SKIPPED",
        message:
          "CognoDB session unavailable — retaining events in buffer for retry",
        retainedCount: batch.length,
      });
      this.requeueEvents(batch);
      return;
    }

    try {
      const batchParams = batch.map((evt, idx) => ({
        [`src_${idx}`]: evt.sourceWallet,
        [`dst_${idx}`]: evt.destinationWallet,
        [`amt_${idx}`]: evt.amount,
        [`ts_${idx}`]: evt.timestamp,
        [`tok_${idx}`]: evt.tokenSymbol,
        [`sig_${idx}`]: evt.txSignature,
        [`prog_${idx}`]: evt.programId,
        [`slot_${idx}`]: evt.slot,
      }));

      // Flatten all params into a single parameter object
      const params: Record<string, string | number> = {};
      for (const p of batchParams) {
        for (const [key, value] of Object.entries(p)) {
          params[key] = value;
        }
      }

      // Build a single MERGE query for the entire batch
      const mergeStatements = batch.map(
        (_, idx) =>
          `MERGE (src_${idx}:Wallet {address: $src_${idx}})
         MERGE (dst_${idx}:Wallet {address: $dst_${idx}})
         MERGE (src_${idx})-[r_${idx}:TRANSFERRED {txSignature: $sig_${idx}}]->(dst_${idx})
         SET r_${idx}.amount = $amt_${idx},
             r_${idx}.timestamp = $ts_${idx},
             r_${idx}.tokenSymbol = $tok_${idx},
             r_${idx}.programId = $prog_${idx},
             r_${idx}.slot = $slot_${idx}`,
      );

      const cypher = mergeStatements.join("\nWITH 1 AS _dummy\n");

      await session.run(cypher, params);

      this.logger.log({
        event: "INGESTION_FLUSH_COMPLETE",
        batchSize: batch.length,
      });
    } catch (err: unknown) {
      this.logger.error({
        event: "INGESTION_FLUSH_ERROR",
        error: err instanceof Error ? err.message : String(err),
        batchSize: batch.length,
        message: "Re-queueing unpersisted events for retry",
      });
      this.requeueEvents(batch);
    } finally {
      await session.close();
    }
  }

  /**
   * Re-queues unpersisted events to the front of eventBuffer up to maxBufferSize (Comment 3).
   */
  private requeueEvents(batch: IngestedTransferEvent[]): void {
    const combined = [...batch, ...this.eventBuffer];
    this.eventBuffer = combined.slice(0, this.maxBufferSize);
  }
}
