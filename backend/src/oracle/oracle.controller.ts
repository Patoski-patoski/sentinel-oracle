import {
  BadRequestException,
  Controller,
  Get,
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
}

@Controller("api/v1/oracle")
export class OracleController {
  constructor(
    private readonly oracleService: OracleService,
    private readonly seedService: SeedService,
    private readonly mooveService: MooveService,
    private readonly configService: ConfigService,
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

  @Get("health")
  getHealth(): HealthPayload {
    return {
      status: "ok",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      payments: {
        mode: this.mooveService.isMockMode() ? "mock" : "live",
        amount: "0.0003",
        currency: "SOL",
        recipient:
          this.configService.get("MOOVE_RECIPIENT_HANDLE") ?? "sentinel.moove",
      },
    };
  }
}
