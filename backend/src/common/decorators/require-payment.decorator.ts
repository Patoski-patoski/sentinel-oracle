import { SetMetadata } from "@nestjs/common";

export const REQUIRE_PAYMENT_KEY = "REQUIRE_PAYMENT_KEY";

export interface PaymentRequirementOptions {
  amount?: string;
  currency?: string;
  network?: string;
}

export const RequirePayment = (options: PaymentRequirementOptions = {}) =>
  SetMetadata(REQUIRE_PAYMENT_KEY, {
    amount: options.amount ?? "0.0003",
    currency: options.currency ?? "SOL",
    network: options.network ?? "solana-mainnet",
  });
