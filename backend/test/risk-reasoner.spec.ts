import { describe, it, expect } from "bun:test";
import { RiskReasonerService } from "../src/ai/risk-reasoner.service.js";
import { ConfigService } from "../src/config/config.service.js";

describe("RiskReasonerService", () => {
  function createDeterministicService(): RiskReasonerService {
    const prevGemini = process.env["GEMINI_API_KEY"];
    const prevOpenAI = process.env["OPENAI_API_KEY"];
    process.env["GEMINI_API_KEY"] = "";
    process.env["OPENAI_API_KEY"] = "";
    try {
      return new RiskReasonerService(new ConfigService());
    } finally {
      if (prevGemini === undefined) {
        delete process.env["GEMINI_API_KEY"];
      } else {
        process.env["GEMINI_API_KEY"] = prevGemini;
      }
      if (prevOpenAI === undefined) {
        delete process.env["OPENAI_API_KEY"];
      } else {
        process.env["OPENAI_API_KEY"] = prevOpenAI;
      }
    }
  }

  it("correctly evaluates high-risk cluster ($MOON)", async () => {
    const service = createDeterministicService();
    const mockGraph = {
      analyzedNodes: 43,
      analyzedRelationships: 53,
      sybilCount: 12,
      washVolumeSol: 19940,
      peelingHopsToCex: 6,
      cycles: [
        {
          originAddress: "7Y4d...WashMaster",
          hopCount: 4,
          totalVolume: 19940,
          tokenSymbol: "MOON",
        },
      ],
      sybils: [
        {
          funderAddress: "7Y4d...WashMaster",
          funderLabel: "Wash Mastermind",
          targetSymbol: "MOON",
          sybilCount: 12,
          totalFundedAmount: 48,
        },
      ],
      peelingChains: [
        {
          originAddress: "7Y4d...WashMaster",
          destinationLabel: "Binance Hot Wallet",
          startAmount: 50,
          finalAmount: 0.1,
          hopCount: 6,
        },
      ],
      queryDurationMs: 15,
    };

    const result = await service.synthesizeRisk("MOON", mockGraph);
    expect(result.oracleVerdict.canExecute).toBe(false);
    expect(result.oracleVerdict.verdict).toBe("REJECT_SWAP");
    expect(result.oracleVerdict.riskScore).toBeGreaterThanOrEqual(90);
    expect(
      result.oracleVerdict.detectedAnomalies.length,
    ).toBeGreaterThanOrEqual(2);
    expect(result.agentSemanticContext).toContain("CRITICAL WARNING");
  });

  it("correctly evaluates clean decentralized token ($SAFE)", async () => {
    const service = createDeterministicService();
    const mockGraph = {
      analyzedNodes: 85,
      analyzedRelationships: 190,
      sybilCount: 0,
      washVolumeSol: 0,
      peelingHopsToCex: 0,
      cycles: [],
      sybils: [],
      peelingChains: [],
      queryDurationMs: 12,
    };

    const result = await service.synthesizeRisk("SAFE", mockGraph);
    expect(result.oracleVerdict.canExecute).toBe(true);
    expect(result.oracleVerdict.verdict).toBe("APPROVE_SWAP");
    expect(result.oracleVerdict.riskScore).toBeLessThan(30);
    expect(result.oracleVerdict.detectedAnomalies.length).toBe(0);
    expect(result.agentSemanticContext).toContain("NOMINAL");
  });
});
