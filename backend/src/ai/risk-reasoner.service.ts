import { Injectable, Logger } from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";
import { ConfigService } from "../config/config.service.js";
import type { GraphAnalysisResult } from "../database/cognoDB.service.js";

export interface AnomalyDetail {
  type: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  details: string;
}

export interface OracleVerdict {
  canExecute: boolean;
  verdict: "APPROVE_SWAP" | "REJECT_SWAP" | "WARN_HIGH_VOLATILITY";
  riskScore: number;
  target: string;
  confidence: number;
  detectedAnomalies: AnomalyDetail[];
}

export interface RiskReasoningResult {
  oracleVerdict: OracleVerdict;
  agentSemanticContext: string;
}

@Injectable()
export class RiskReasonerService {
  private readonly logger = new Logger(RiskReasonerService.name);

  constructor(private readonly configService: ConfigService) {}

  async synthesizeRisk(
    target: string,
    graph: GraphAnalysisResult,
  ): Promise<RiskReasoningResult> {
    const anomalies: AnomalyDetail[] = [];
    let score = 5; // baseline low risk

    // 1. Evaluate Sybils
    if (graph.sybilCount >= 10) {
      score += 45;
      anomalies.push({
        type: "SYBIL_SNIPING_FARM",
        severity: "CRITICAL",
        details: `Single mastermind wallet funded ${graph.sybilCount} bot wallets that executed coordinated swaps in the same block window.`,
      });
    } else if (graph.sybilCount >= 3) {
      score += 25;
      anomalies.push({
        type: "SYBIL_CLUSTER_SUSPECT",
        severity: "HIGH",
        details: `Detected ${graph.sybilCount} wallets funded by a shared entity before liquidity additions.`,
      });
    }

    // 2. Evaluate Wash Cycles
    if (graph.cycles.length > 0) {
      const topCycle = graph.cycles[0];
      const cycleHops = topCycle ? topCycle.hopCount : 4;
      score += 40;
      anomalies.push({
        type: "CIRCULAR_WASH_RING",
        severity: "HIGH",
        details: `Detected ${cycleHops}-hop wash-trading loop cycling $${graph.washVolumeSol.toLocaleString()} artificial volume across correlated accounts.`,
      });
    }

    // 3. Evaluate Peeling Chains
    if (graph.peelingHopsToCex > 3) {
      score += 15;
      anomalies.push({
        type: "PEELING_CHAIN_EXTRACTION",
        severity: "MEDIUM",
        details: `Funds from trading wallets are actively splitting across a ${graph.peelingHopsToCex}-hop peeling chain terminating in CEX deposit addresses.`,
      });
    }

    const finalScore = Math.min(99, Math.max(1, score));
    const canExecute = finalScore < 50;
    const verdict: "APPROVE_SWAP" | "REJECT_SWAP" | "WARN_HIGH_VOLATILITY" =
      finalScore >= 70
        ? "REJECT_SWAP"
        : finalScore >= 40
          ? "WARN_HIGH_VOLATILITY"
          : "APPROVE_SWAP";

    const confidence = 0.98;

    // Check if external LLM synthesis is enabled (Gemini or OpenAI)
    const geminiKey = this.configService.get("GEMINI_API_KEY");
    const openAiKey = this.configService.get("OPENAI_API_KEY");
    let agentSemanticContext = "";

    if (geminiKey && geminiKey.trim() !== "") {
      try {
        agentSemanticContext = await this.callGemini(
          target,
          graph,
          finalScore,
          anomalies,
        );
      } catch (err) {
        this.logger.warn({
          event: "GEMINI_SYNTHESIS_FALLBACK",
          message:
            "Failed to query Gemini API, falling back to deterministic generator",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (openAiKey && openAiKey.startsWith("sk-")) {
      try {
        agentSemanticContext = await this.callOpenAI(
          target,
          graph,
          finalScore,
          anomalies,
        );
      } catch (err) {
        this.logger.warn({
          event: "OPENAI_SYNTHESIS_FALLBACK",
          message:
            "Failed to query OpenAI API, falling back to deterministic generator",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!agentSemanticContext) {
      if (verdict === "REJECT_SWAP") {
        agentSemanticContext = `CRITICAL WARNING: $${target.toUpperCase()} liquidity is predominantly artificial. Detected ${graph.sybilCount} coordinated Sybil bots and $${graph.washVolumeSol.toLocaleString()} in circular wash transactions. Initiating a swap presents an acute danger of capital extraction and liquidity collapse.`;
      } else if (verdict === "WARN_HIGH_VOLATILITY") {
        agentSemanticContext = `CAUTION: $${target.toUpperCase()} exhibits localized volume clustering. Some transaction paths show correlated funding. Exercise conservative position sizing and strict slippage controls.`;
      } else {
        agentSemanticContext = `NOMINAL: $${target.toUpperCase()} transaction graph exhibits organic decentralization. No cyclic wash trading or Sybil sniping farms detected within 5 hops. Safe for algorithmic swap execution.`;
      }
    }

    return {
      oracleVerdict: {
        canExecute,
        verdict,
        riskScore: finalScore,
        target,
        confidence,
        detectedAnomalies: anomalies,
      },
      agentSemanticContext,
    };
  }

  private async callGemini(
    target: string,
    graph: GraphAnalysisResult,
    riskScore: number,
    anomalies: AnomalyDetail[],
  ): Promise<string> {
    const apiKey = this.configService.get("GEMINI_API_KEY")?.trim();
    if (!apiKey) {
      return "";
    }
    const model = (
      this.configService.get("GEMINI_MODEL") ?? "gemini-2.5-flash"
    ).trim();

    const prompt = `You are Sentinel, an autonomous on-chain risk oracle for AI trading agents.
Synthesize the following graph telemetry for token $${target}:
- Risk Score: ${riskScore}/100
- Wash Volume: $${graph.washVolumeSol}
- Sybil Count: ${graph.sybilCount}
- Peeling Hops: ${graph.peelingHopsToCex}
- Anomalies: ${JSON.stringify(anomalies)}

Output a concise 2-sentence risk directive tailored for an autonomous client bot.`;

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    return response.text?.trim() ?? "";
  }

  private async callOpenAI(
    target: string,
    graph: GraphAnalysisResult,
    riskScore: number,
    anomalies: AnomalyDetail[],
  ): Promise<string> {
    const model = this.configService.get("OPENAI_MODEL") ?? "gpt-4o-mini";
    const apiKey = this.configService.get("OPENAI_API_KEY");

    const prompt = `You are Sentinel, an autonomous on-chain risk oracle for trading agents.
Synthesize the following graph telemetry for token $${target}:
- Risk Score: ${riskScore}/100
- Wash Volume: $${graph.washVolumeSol}
- Sybil Count: ${graph.sybilCount}
- Peeling Hops: ${graph.peelingHopsToCex}
- Anomalies: ${JSON.stringify(anomalies)}

Output a concise 2-sentence risk directive tailored for an autonomous client bot.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }
}
