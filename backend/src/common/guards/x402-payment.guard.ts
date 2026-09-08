import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
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

export interface AuthenticatedPaymentRequest extends Request {
  paymentReceipt?: PaymentReceipt;
}

@Injectable()
export class X402PaymentGuard implements CanActivate {
  private readonly logger = new Logger(X402PaymentGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly mooveService: MooveService,
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
