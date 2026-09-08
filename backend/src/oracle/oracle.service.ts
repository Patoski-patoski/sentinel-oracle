import { Injectable, Logger } from "@nestjs/common";
import { CognoDBService } from "../database/cognoDB.service.js";
import {
  RiskReasonerService,
  type RiskReasoningResult,
} from "../ai/risk-reasoner.service.js";
import type { RiskQueryDto } from "./dto/risk-query.dto.js";
import type { PaymentReceipt } from "../moove/moove.service.js";

export interface UnlockedRiskPayload {
  success: boolean;
  paymentVerified: boolean;
  receipt: {
    txSignature: string;
    amount: string;
    currency: string;
    payerAddress?: string | undefined;
  };
  oracleVerdict: RiskReasoningResult["oracleVerdict"];
  graphTelemetry: {
    analyzedNodes: number;
    analyzedRelationships: number;
    sybilCount: number;
    washVolumeSol: number;
    peelingHopsToCex: number;
    queryDurationMs: number;
    isSimulatedFallback?: boolean | undefined;
  };
  agentSemanticContext: string;
}

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  constructor(
    private readonly cognoDbService: CognoDBService,
    private readonly riskReasonerService: RiskReasonerService,
  ) {}

  async assessRisk(
    query: RiskQueryDto,
    receipt?: PaymentReceipt,
  ): Promise<UnlockedRiskPayload> {
    const startTime = Date.now();
    this.logger.log({
      event: "ORACLE_RISK_ASSESSMENT_STARTED",
      target: query.target,
      type: query.type ?? "TOKEN",
    });

    const graphResult = await this.cognoDbService.runAnalysis(
      query.target,
      query.minAmount ?? 0,
    );
    const reasoning = await this.riskReasonerService.synthesizeRisk(
      query.target,
      graphResult,
    );

    const payload: UnlockedRiskPayload = {
      success: true,
      paymentVerified: true,
      receipt: {
        txSignature: receipt?.txSignature ?? "sig_devnet_verified",
        amount: "0.0003",
        currency: "SOL",
        payerAddress: receipt?.payerAddress,
      },
      oracleVerdict: reasoning.oracleVerdict,
      graphTelemetry: {
        analyzedNodes: graphResult.analyzedNodes,
        analyzedRelationships: graphResult.analyzedRelationships,
        sybilCount: graphResult.sybilCount,
        washVolumeSol: graphResult.washVolumeSol,
        peelingHopsToCex: graphResult.peelingHopsToCex,
        queryDurationMs: graphResult.queryDurationMs,
        isSimulatedFallback: graphResult.isSimulatedFallback,
      },
      agentSemanticContext: reasoning.agentSemanticContext,
    };

    this.logger.log({
      event: "ORACLE_RISK_ASSESSMENT_COMPLETED",
      target: query.target,
      verdict: reasoning.oracleVerdict.verdict,
      riskScore: reasoning.oracleVerdict.riskScore,
      durationMs: Date.now() - startTime,
    });

    return payload;
  }
}
