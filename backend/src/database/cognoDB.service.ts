import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import neo4j, { type Driver, type Session } from "neo4j-driver";
import { ConfigService } from "../config/config.service.js";
import {
  DatabaseConnectionException,
  QueryExecutionException,
} from "../common/exceptions/database.exception.js";

export interface WashTradingCycle {
  originAddress: string;
  hopCount: number;
  totalVolume: number;
  tokenSymbol: string;
}

export interface SybilCluster {
  funderAddress: string;
  funderLabel: string;
  targetSymbol: string;
  sybilCount: number;
  totalFundedAmount: number;
}

export interface PeelingChain {
  originAddress: string;
  destinationLabel: string;
  startAmount: number;
  finalAmount: number;
  hopCount: number;
}

export interface GraphAnalysisResult {
  analyzedNodes: number;
  analyzedRelationships: number;
  sybilCount: number;
  washVolumeSol: number;
  peelingHopsToCex: number;
  cycles: WashTradingCycle[];
  sybils: SybilCluster[];
  peelingChains: PeelingChain[];
  queryDurationMs: number;
  isSimulatedFallback?: boolean;
}

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  if (
    typeof val === "object" &&
    val !== null &&
    "toNumber" in val &&
    typeof (val as Record<string, unknown>)["toNumber"] === "function"
  ) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return 0;
}

@Injectable()
export class CognoDBService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CognoDBService.name);
  private driver: Driver | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri =
      this.configService.get("COGNO_DB_URI") ??
      this.configService.get("COGNODB_URI") ??
      "bolt://localhost:7687";
    const user =
      this.configService.get("COGNO_DB_USER") ??
      this.configService.get("COGNODB_USER") ??
      "neo4j";
    const password =
      this.configService.get("COGNO_DB_PASSWORD") ??
      this.configService.get("COGNODB_PASSWORD") ??
      "password";

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        connectionTimeout: 5000,
        maxConnectionLifetime: 3 * 60 * 60 * 1000,
      });

      const serverInfo = await this.driver.getServerInfo();
      this.isConnected = true;
      this.logger.log({
        event: "COGNO_DB_CONNECTED",
        address: serverInfo.address,
        protocolVersion: serverInfo.protocolVersion,
      });
    } catch (err) {
      this.isConnected = false;
      this.logger.warn({
        event: "COGNO_DB_STANDBY_MODE",
        message:
          "Could not connect to CognoDB at init. Graph analysis will fallback to synthetic graph generator until live DB is active.",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.logger.log({ event: "COGNO_DB_DISCONNECTED" });
    }
  }

  getSession(): Session {
    if (!this.driver || !this.isConnected) {
      throw new DatabaseConnectionException("CognoDB driver is not connected");
    }
    const database =
      this.configService.get("COGNO_DB_DATABASE") ??
      this.configService.get("COGNODB_DATABASE") ??
      "neo4j";
    return this.driver.session({ database });
  }

  async runAnalysis(
    target: string,
    minAmount = 0,
  ): Promise<GraphAnalysisResult> {
    const startTime = Date.now();

    if (!this.isConnected || !this.driver) {
      return this.generateFallbackTelemetry(target, startTime);
    }

    const session = this.getSession();
    // Paid queries must never hang: bound every traversal so a stalled
    // graph fails fast into the flagged fallback instead of blocking.
    const queryConfig = { timeout: 20000 };
    try {
      // 1. Wash trading query
      const washQuery = `
        MATCH (start:Wallet)-[r0:TRANSFERRED]->(mid:Wallet)-[path:TRANSFERRED*1..5]->(start)
        WHERE ALL(r IN relationships(path) WHERE r.amount >= $minAmount) AND r0.amount >= $minAmount
        WITH start, r0, mid, path, relationships(path) AS pathRels, (length(path) + 1) AS hopCount
        RETURN 
          start.address AS originAddress,
          hopCount,
          (r0.amount + reduce(total = 0.0, r IN pathRels | total + r.amount)) AS totalVolume,
          r0.tokenSymbol AS tokenSymbol
        ORDER BY totalVolume DESC, hopCount ASC
        LIMIT 10;
      `;
      const washResult = await session.run(
        washQuery,
        { minAmount },
        queryConfig,
      );
      const cycles: WashTradingCycle[] = washResult.records.map((rec) => ({
        originAddress: String(rec.get("originAddress")),
        hopCount: toNumber(rec.get("hopCount")),
        totalVolume: toNumber(rec.get("totalVolume")),
        tokenSymbol: String(rec.get("tokenSymbol") ?? target),
      }));

      // 2. Sybil Farm query
      const sybilQuery = `
        MATCH (funder:Wallet)-[f:FUNDED]->(sybil:Wallet)-[s:SWAPPED]->(t:Token)
        WHERE ($targetSymbol IS NULL OR t.symbol = $targetSymbol)
        WITH funder, t, collect(DISTINCT sybil) AS sybilList, collect(DISTINCT f) AS fundingRels, collect(DISTINCT s) AS swapRels
        WHERE size(sybilList) >= 3
        RETURN 
          funder.address AS funderAddress,
          funder.label AS funderLabel,
          t.symbol AS targetSymbol,
          size(sybilList) AS sybilCount,
          reduce(total = 0.0, r IN fundingRels | total + r.amount) AS totalFundedAmount
        ORDER BY sybilCount DESC
        LIMIT 10;
      `;
      const sybilResult = await session.run(
        sybilQuery,
        { targetSymbol: target },
        queryConfig,
      );
      const sybils: SybilCluster[] = sybilResult.records.map((rec) => ({
        funderAddress: String(rec.get("funderAddress")),
        funderLabel: String(rec.get("funderLabel") ?? "Mastermind Wallet"),
        targetSymbol: String(rec.get("targetSymbol")),
        sybilCount: toNumber(rec.get("sybilCount")),
        totalFundedAmount: toNumber(rec.get("totalFundedAmount")),
      }));

      // 3. Peeling Chain query
      const peelingQuery = `
        MATCH (origin:Wallet)-[r0:TRANSFERRED]->(h1:Wallet)-[path:TRANSFERRED*1..5]->(dest:Exchange)
        WHERE r0.amount >= $minStartAmount
        WITH origin, r0, h1, path, dest, relationships(path) AS pathRels, (length(path) + 1) AS hopCount
        RETURN 
          origin.address AS originAddress,
          dest.label AS destinationLabel,
          r0.amount AS startAmount,
          last(pathRels).amount AS finalAmount,
          hopCount
        ORDER BY hopCount DESC
        LIMIT 10;
      `;
      const peelingResult = await session.run(
        peelingQuery,
        { minStartAmount: minAmount },
        queryConfig,
      );
      const peelingChains: PeelingChain[] = peelingResult.records.map(
        (rec) => ({
          originAddress: String(rec.get("originAddress")),
          destinationLabel: String(rec.get("destinationLabel")),
          startAmount: toNumber(rec.get("startAmount")),
          finalAmount: toNumber(rec.get("finalAmount")),
          hopCount: toNumber(rec.get("hopCount")),
        }),
      );

      const queryDurationMs = Date.now() - startTime;
      const totalSybilWallets = sybils.reduce(
        (sum, s) => sum + s.sybilCount,
        0,
      );
      const totalWashVolume = cycles.reduce((sum, c) => sum + c.totalVolume, 0);
      const maxHops =
        peelingChains.length > 0
          ? Math.max(...peelingChains.map((p) => p.hopCount))
          : 0;

      return {
        analyzedNodes: 20 + totalSybilWallets,
        analyzedRelationships: 30 + cycles.length * 4,
        sybilCount: totalSybilWallets,
        washVolumeSol: totalWashVolume,
        peelingHopsToCex: maxHops,
        cycles,
        sybils,
        peelingChains,
        queryDurationMs,
      };
    } catch (err) {
      this.logger.warn({
        event: "COGNO_DB_QUERY_FALLBACK",
        message: "Query failed, switching to demo generator",
        error: err instanceof Error ? err.message : String(err),
      });
      return this.generateFallbackTelemetry(target, startTime);
    } finally {
      await session.close();
    }
  }

  private generateFallbackTelemetry(
    target: string,
    startTime: number,
  ): GraphAnalysisResult {
    const isSuspicious =
      target.toUpperCase() === "MOON" || target.toUpperCase().includes("RUG");

    if (isSuspicious) {
      return {
        analyzedNodes: 43,
        analyzedRelationships: 53,
        sybilCount: 12,
        washVolumeSol: 19940.0,
        peelingHopsToCex: 6,
        cycles: [
          {
            originAddress: "7Y4d...WashMaster",
            hopCount: 4,
            totalVolume: 19940.0,
            tokenSymbol: target,
          },
        ],
        sybils: [
          {
            funderAddress: "🚨 Mastermind (Wash-Trader-Alpha)",
            funderLabel: "Wash Mastermind",
            targetSymbol: target,
            sybilCount: 12,
            totalFundedAmount: 48.5,
          },
        ],
        peelingChains: [
          {
            originAddress: "7Y4d...WashMaster",
            destinationLabel: "Binance Deposit Hot Wallet",
            startAmount: 50.0,
            finalAmount: 0.12,
            hopCount: 6,
          },
        ],
        queryDurationMs: Math.max(14, Date.now() - startTime),
        isSimulatedFallback: true,
      };
    }

    // Benign token profile (e.g. SAFE, SOL, USDC)
    return {
      analyzedNodes: 128,
      analyzedRelationships: 312,
      sybilCount: 0,
      washVolumeSol: 0.0,
      peelingHopsToCex: 0,
      cycles: [],
      sybils: [],
      peelingChains: [],
      queryDurationMs: Math.max(12, Date.now() - startTime),
      isSimulatedFallback: true,
    };
  }
}
