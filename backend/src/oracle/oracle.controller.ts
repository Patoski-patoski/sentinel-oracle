import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { OracleService, type UnlockedRiskPayload } from "./oracle.service.js";
import { RiskQuerySchema, type RiskQueryDto } from "./dto/risk-query.dto.js";
import {
  PaymentStatusQuerySchema,
  type PaymentStatusQueryDto,
} from "./dto/payment-status-query.dto.js";
import { RequirePayment } from "../common/decorators/require-payment.decorator.js";
import {
  X402PaymentGuard,
  type AuthenticatedPaymentRequest,
} from "../common/guards/x402-payment.guard.js";
import { TypeBoxValidationPipe } from "../common/pipes/typebox-validation.pipe.js";
import { MooveService, type PaymentStatus } from "../moove/moove.service.js";
import { ConfigService } from "../config/config.service.js";
import {
  SessionPassService,
  type SessionPassStatus,
} from "./session-pass.service.js";

import { SeedService } from "../seed/seed.service.js";

interface HealthPayload {
  status: string;
  timestamp: string;
  version: string;
  payments: {
    mode: "mock" | "live";
    amount: string;
    currency: string;
    recipient: string;
  };
  features: {
    sessionPasses: boolean;
    liveIngestion: boolean;
  };
}

interface SessionPassChallengeResponse {
  challengeId: string;
  amount: string;
  currency: string;
  network: string;
  recipientAddress: string;
  description: string;
  linkId?: string | undefined;
  paymentUrl?: string | undefined;
}

interface SessionPassClaimResponse {
  sessionToken: string;
  passId: string;
  maxQueries: number;
  expiresAt: string;
}

@Controller("api/v1/oracle")
export class OracleController {
  constructor(
    private readonly oracleService: OracleService,
    private readonly seedService: SeedService,
    private readonly mooveService: MooveService,
    private readonly configService: ConfigService,
    private readonly sessionPassService: SessionPassService,
  ) {}

  @Get("seed")
  async triggerSeedGet(): Promise<{ success: boolean; message: string }> {
    return this.seedService.seedDemoData();
  }

  @Post("seed")
  async triggerSeedPost(): Promise<{ success: boolean; message: string }> {
    return this.seedService.seedDemoData();
  }

  @Get("risk")
  @RequirePayment({ amount: "0.0003", currency: "SOL" })
  @UseGuards(X402PaymentGuard)
  @UsePipes(new TypeBoxValidationPipe(RiskQuerySchema))
  async getRiskAssessment(
    @Query() query: RiskQueryDto,
    @Req() req: AuthenticatedPaymentRequest,
  ): Promise<UnlockedRiskPayload> {
    return this.oracleService.assessRisk(query, req.paymentReceipt);
  }

  /**
   * Poll-friendly settlement lookup for the real Moove flow:
   * 402 challenge -> payer completes paymentUrl checkout ->
   * poll here until status === 'completed' -> retry /risk with linkId.
   */
  @Get("payment/:challengeId/status")
  async getPaymentStatus(
    @Param("challengeId") challengeId: string,
    @Query(new TypeBoxValidationPipe(PaymentStatusQuerySchema))
    query: PaymentStatusQueryDto,
  ): Promise<PaymentStatus> {
    if (!challengeId || challengeId.trim() === "") {
      throw new BadRequestException("challengeId path parameter is required");
    }
    return this.mooveService.getPaymentStatus(challengeId, query.linkId);
  }

  // ── Session Pass Endpoints ──────────────────────────────────────────

  /**
   * Request a Session Pass payment challenge.
   * The agent pays 0.01 SOL once to unlock 100 queries (or 24h).
   */
  @Post("pass/challenge")
  async requestSessionPassChallenge(): Promise<SessionPassChallengeResponse> {
    const challenge = await this.mooveService.createChallenge("0.01", "SOL");
    return {
      challengeId: challenge.challengeId,
      amount: challenge.amount,
      currency: challenge.currency,
      network: challenge.network,
      recipientAddress: challenge.recipientAddress,
      description: "Session Pass: 100 queries / 24h",
      linkId: challenge.linkId,
      paymentUrl: challenge.paymentUrl,
    };
  }

  /**
   * Claim a Session Pass after on-chain payment settlement.
   * Returns an HMAC-signed token to use as `X-SESSION-TOKEN` header.
   */
  @Post("pass/claim")
  async claimSessionPass(
    @Headers("x-payment") paymentHeader?: string,
  ): Promise<SessionPassClaimResponse> {
    if (!paymentHeader) {
      throw new BadRequestException(
        "X-PAYMENT header with payment receipt is required to claim a session pass",
      );
    }

    let receipt: {
      challengeId: string;
      txSignature?: string;
      payerAddress?: string;
      linkId?: string;
    };
    try {
      receipt = JSON.parse(paymentHeader) as typeof receipt;
    } catch {
      throw new BadRequestException("X-PAYMENT header must be valid JSON");
    }

    if (!receipt.challengeId) {
      throw new BadRequestException("challengeId is required in X-PAYMENT");
    }

    // Verify the payment
    await this.mooveService.verifyPayment(receipt);

    const payerAddress = receipt.payerAddress ?? "unknown";
    const token = this.sessionPassService.generateToken(payerAddress);

    // Decode to get pass metadata
    const status = this.sessionPassService.getStatus(token);
    if (!status) {
      throw new BadRequestException("Failed to generate session pass");
    }

    return {
      sessionToken: token,
      passId: status.passId,
      maxQueries: status.maxQueries,
      expiresAt: status.expiresAt,
    };
  }

  /**
   * Check remaining quota and expiration for a session pass.
   */
  @Get("pass/status")
  getSessionPassStatus(
    @Headers("x-session-token") token?: string,
  ): SessionPassStatus {
    if (!token) {
      throw new BadRequestException(
        "X-SESSION-TOKEN header is required to check pass status",
      );
    }

    const status = this.sessionPassService.getStatus(token);
    if (!status) {
      throw new BadRequestException("Invalid or expired session pass token");
    }

    return status;
  }

  @Get("health")
  getHealth(): HealthPayload {
    return {
      status: "ok",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
      payments: {
        mode: this.mooveService.isMockMode() ? "mock" : "live",
        amount: "0.0003",
        currency: "SOL",
        recipient:
          this.configService.get("MOOVE_RECIPIENT_HANDLE") ?? "sentinel.moove",
      },
      features: {
        sessionPasses: true,
        liveIngestion: true,
      },
    };
  }
}
