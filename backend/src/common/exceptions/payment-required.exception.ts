import { HttpException, HttpStatus } from "@nestjs/common";

export interface PaymentChallenge {
  challengeId: string;
  amount: string;
  currency: string;
  network: string;
  recipient: string;
  recipientAddress: string;
  paymentUrl?: string;
  linkId?: string;
  validUntil: string;
  instructions: {
    headerName: string;
    format: string;
  };
}

export class PaymentRequiredException extends HttpException {
  public readonly challenge: PaymentChallenge;

  constructor(challenge: PaymentChallenge) {
    const payload = {
      status: HttpStatus.PAYMENT_REQUIRED,
      error: "Payment Required",
      message: "Autonomous Risk Assessment requires an on-chain micro-payment.",
      challenge,
    };
    super(payload, HttpStatus.PAYMENT_REQUIRED);
    this.challenge = challenge;
  }
}

export class InvalidPaymentException extends HttpException {
  constructor(reason: string) {
    super(
      {
        status: HttpStatus.BAD_REQUEST,
        error: "Invalid Payment Proof",
        message: reason,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export interface PendingPaymentBody {
  status: number;
  error: string;
  message: string;
  challengeId: string;
  linkId?: string;
  linkStatus?: string;
  paymentUrl?: string;
}

/**
 * Thrown when a payment link exists but has not settled yet.
 * Surfaces as HTTP 202 so clients know to keep polling the
 * payment-status endpoint instead of treating it as a rejection.
 */
export class PaymentPendingException extends HttpException {
  constructor(body: Omit<PendingPaymentBody, "status" | "error">) {
    super(
      {
        status: HttpStatus.ACCEPTED,
        error: "Payment Pending",
        ...body,
      },
      HttpStatus.ACCEPTED,
    );
  }
}
