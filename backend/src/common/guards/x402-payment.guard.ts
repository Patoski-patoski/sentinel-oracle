import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import {
  REQUIRE_PAYMENT_KEY,
  type PaymentRequirementOptions,
} from "../decorators/require-payment.decorator.js";
import {
  MooveService,
  type PaymentReceipt,
} from "../../moove/moove.service.js";
import {
  PaymentRequiredException,
  InvalidPaymentException,
} from "../exceptions/payment-required.exception.js";
import { SessionPassService } from "../../oracle/session-pass.service.js";

export interface AuthenticatedPaymentRequest extends Request {
  paymentReceipt?: PaymentReceipt;
  sessionPassId?: string;
}

@Injectable()
export class X402PaymentGuard implements CanActivate {
  private readonly logger = new Logger(X402PaymentGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly mooveService: MooveService,
    private readonly sessionPassService: SessionPassService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const paymentOptions = this.reflector.getAllAndOverride<
      PaymentRequirementOptions | undefined
    >(REQUIRE_PAYMENT_KEY, [context.getHandler(), context.getClass()]);

    // If endpoint doesn't require payment, allow through
    if (!paymentOptions) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedPaymentRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    // ── Session Pass Fast Path ──────────────────────────────────────────
    // Check X-SESSION-TOKEN header first. If valid, bypass 402 entirely.
    const sessionToken =
      request.headers["x-session-token"] ?? request.headers["X-SESSION-TOKEN"];

    if (sessionToken && typeof sessionToken === "string") {
      const result = this.sessionPassService.consumeQuery(sessionToken);
      if (result.valid) {
        this.logger.log({
          event: "SESSION_PASS_CONSUMED",
          passId: result.passId,
          remaining: result.remaining,
          path: request.url,
        });
        response.setHeader("X-Session-Remaining", result.remaining.toString());
        request.sessionPassId = result.passId;
        return true;
      }
      this.logger.warn({
        event: "SESSION_PASS_REJECTED",
        reason: result.reason,
        path: request.url,
      });
      throw new InvalidPaymentException(
        `Session pass invalid: ${result.reason}`,
      );
    }

    // ── Standard x402 Payment Path ──────────────────────────────────────
    const paymentHeader =
      request.headers["x-payment"] ?? request.headers["X-PAYMENT"];

    if (!paymentHeader || typeof paymentHeader !== "string") {
      this.logger.log({
        event: "402_CHALLENGE_ISSUED",
        path: request.url,
        amount: paymentOptions.amount ?? "0.0003",
      });

      const challenge = await this.mooveService.createChallenge(
        paymentOptions.amount,
        paymentOptions.currency,
      );
      throw new PaymentRequiredException(challenge);
    }

    let receipt: PaymentReceipt;
    try {
      receipt = JSON.parse(paymentHeader) as PaymentReceipt;
    } catch {
      throw new InvalidPaymentException("X-PAYMENT header must be valid JSON");
    }

    const isVerified = await this.mooveService.verifyPayment(receipt);
    if (!isVerified) {
      throw new InvalidPaymentException(
        "Cryptographic payment verification failed",
      );
    }

    request.paymentReceipt = receipt;
    return true;
  }
}
