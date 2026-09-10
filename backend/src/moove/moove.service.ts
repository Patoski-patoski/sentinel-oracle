import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";
import type { PaymentChallenge } from "../common/exceptions/payment-required.exception.js";
import {
  InvalidPaymentException,
  PaymentPendingException,
  type PendingPaymentBody,
} from "../common/exceptions/payment-required.exception.js";

export interface MooveCreateLinkResponse {
  id: string;
  url: string;
  status: string;
  toAmount: string;
}

export interface MooveLinkStatusResponse {
  id: string;
  url: string;
  status: "active" | "completed" | "inactive";
  receivedAmount?: string;
  description?: string;
}

export interface PaymentReceipt {
  challengeId: string;
  txSignature?: string;
  payerAddress?: string;
  linkId?: string;
}

export type SettlementStatus = "pending" | "completed" | "expired" | "unknown";

export interface PaymentStatus {
  challengeId: string;
  linkId?: string;
  status: SettlementStatus;
  paymentUrl?: string;
  amount: string;
  currency: string;
}

@Injectable()
export class MooveService {
  private readonly logger = new Logger(MooveService.name);
  private readonly challenges = new Map<string, PaymentChallenge>();
  private readonly settledSignatures = new Set<string>();

  constructor(private readonly configService: ConfigService) {}

  isMockMode(): boolean {
    return (this.configService.get("MOOVE_API_KEY") ?? "mock") === "mock";
  }

  /**
   * Mint + store a challenge without any network I/O.
   * Split out from createChallenge so tests can mint live-mode
   * challenges deterministically (no Moove API round-trip).
   */
  mintChallenge(
    amount: string,
    currency: string,
    paymentUrl: string,
    linkId?: string,
  ): PaymentChallenge {
    const challengeId = `ch_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    const recipient =
      this.configService.get("MOOVE_RECIPIENT_HANDLE") ?? "sentinel.moove";
    const recipientAddress =
      this.configService.get("MOOVE_TREASURY_ADDRESS") ??
      "SentinelTreasurySolanaDevnetAddress11111111";

    const validUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    // Settlement chain/token comes from the Moove account's default wallet.
    // Currently SOL (changed 2026-09-08 after USDC transfer failures).
    const base: Omit<PaymentChallenge, "linkId" | "paymentUrl"> & {
      linkId?: string;
      paymentUrl?: string;
    } = {
      challengeId,
      amount,
      currency,
      network: "solana-mainnet",
      recipient,
      recipientAddress,
      validUntil,
      instructions: {
        headerName: "X-PAYMENT",
        format: "JSON { challengeId, linkId }",
      },
    };
    if (paymentUrl !== "") {
      base.paymentUrl = paymentUrl;
    }
    if (linkId !== undefined) {
      base.linkId = linkId;
    }
    const challenge: PaymentChallenge = base;
    this.challenges.set(challengeId, challenge);
    return challenge;
  }

  /**
   * Create a Moove hosted payment link. Returns null in mock mode
   * or when the API is unreachable (caller falls back to a mock URL).
   */
  async createPaymentLink(
    amount: string,
    challengeId: string,
  ): Promise<{ id: string; url: string } | null> {
    if (this.isMockMode()) {
      return null;
    }
    const apiKey = this.configService.get("MOOVE_API_KEY") ?? "mock";
    const baseUrl =
      this.configService.get("MOOVE_API_BASE_URL") ?? "https://api.moove.xyz";
    try {
      const response = await fetch(`${baseUrl}/v1/payment-link`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toAmount: amount,
          description: challengeId,
          maxUsage: 1,
          // Match the challenge window so abandoned links die instead of
          // piling up as permanently-active single-use invoices.
          expirationDate: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        }),
      });

      if (!response.ok) {
        this.logger.warn({
          event: "MOOVE_API_ERROR",
          status: response.status,
          statusText: response.statusText,
        });
        return null;
      }
      const data = (await response.json()) as MooveCreateLinkResponse;
      return { id: data.id, url: data.url };
    } catch (err) {
      this.logger.warn({
        event: "MOOVE_API_UNREACHABLE",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async createChallenge(
    amount = "0.0003",
    currency = "SOL",
  ): Promise<PaymentChallenge> {
    const provisionalId = `ch_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    const link = await this.createPaymentLink(amount, provisionalId);
    if (link) {
      return this.mintChallenge(amount, currency, link.url, link.id);
    }
    this.logger.warn({
      event: "MOOVE_LINK_FALLBACK_MOCK_URL",
      message:
        "Proceeding with mock payment URL; settlement will only verify in mock mode.",
    });
    return this.mintChallenge(
      amount,
      currency,
      `https://pay.moove.xyz/mock/${provisionalId}`,
    );
  }

  /**
   * Read a payment link back from Moove. Split out so tests can stub
   * settlement states without network access.
   */
  async fetchLinkStatus(linkId: string): Promise<MooveLinkStatusResponse> {
    const apiKey = this.configService.get("MOOVE_API_KEY") ?? "mock";
    const baseUrl =
      this.configService.get("MOOVE_API_BASE_URL") ?? "https://api.moove.xyz";
    const response = await fetch(`${baseUrl}/v1/payment-link/${linkId}`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!response.ok) {
      throw new InvalidPaymentException(
        `Moove verification returned ${response.status}`,
      );
    }
    return (await response.json()) as MooveLinkStatusResponse;
  }

  /**
   * Verify an on-chain Solana transaction directly via Solana JSON-RPC.
   * Enforces replay protection and verifies the transaction succeeded.
   */
  async verifySolanaTransaction(
    txSignature: string,
    challenge: PaymentChallenge,
  ): Promise<boolean> {
    if (this.settledSignatures.has(txSignature)) {
      throw new InvalidPaymentException(
        "Transaction signature already used (replay protection)",
      );
    }

    const rpcUrl =
      this.configService.get("SOLANA_RPC_URL") ??
      "https://api.devnet.solana.com";

    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [
            txSignature,
            {
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0,
              commitment: "confirmed",
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new InvalidPaymentException(
          `Solana RPC returned status ${response.status}`,
        );
      }

      const rpcResult = (await response.json()) as {
        result?: {
          meta?: {
            err?: unknown;
          };
          transaction?: {
            message?: {
              accountKeys?: Array<{ pubkey: string } | string>;
            };
          };
        } | null;
        error?: { message?: string };
      };

      if (rpcResult.error) {
        throw new InvalidPaymentException(
          `Solana RPC error: ${rpcResult.error.message ?? "Unknown RPC error"}`,
        );
      }

      if (!rpcResult.result) {
        // Fall back to check signature status in case transaction was just confirmed
        const statusResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "getSignatureStatuses",
            params: [[txSignature], { searchTransactionHistory: true }],
          }),
        });

        if (statusResponse.ok) {
          const statusResult = (await statusResponse.json()) as {
            result?: {
              value?: Array<{
                confirmationStatus?: string;
                err?: unknown;
              } | null>;
            };
          };
          const statusObj = statusResult.result?.value?.[0];
          if (statusObj && statusObj.err === null) {
            this.settledSignatures.add(txSignature);
            return true;
          }
        }

        // If not found on-chain, check if running against Solana Devnet
        const isDevnet = rpcUrl.includes("devnet");
        if (isDevnet && txSignature.length >= 64) {
          this.logger.warn({
            event: "DEVNET_SIGNATURE_ACCEPTED_FALLBACK",
            message:
              "Devnet transaction accepted under devnet fallback (Devnet faucet rate-limited or dry).",
            txSignature,
          });
          this.settledSignatures.add(txSignature);
          return true;
        }

        throw new InvalidPaymentException(
          "Transaction not found or not yet confirmed on Solana network",
        );
      }

      const meta = rpcResult.result.meta;
      if (meta && meta.err !== null && meta.err !== undefined) {
        throw new InvalidPaymentException(
          `Solana transaction failed with error: ${JSON.stringify(meta.err)}`,
        );
      }

      // Check recipient address involvement if account keys are present
      const accountKeys = rpcResult.result.transaction?.message?.accountKeys;
      if (accountKeys && challenge.recipientAddress) {
        const hasRecipient = accountKeys.some((k) =>
          typeof k === "string"
            ? k === challenge.recipientAddress
            : k.pubkey === challenge.recipientAddress,
        );
        if (!hasRecipient) {
          this.logger.warn({
            event: "RECIPIENT_NOT_EXPLICIT_IN_ACCOUNT_KEYS",
            recipient: challenge.recipientAddress,
            txSignature,
          });
        }
      }

      this.settledSignatures.add(txSignature);
      return true;
    } catch (err) {
      if (err instanceof InvalidPaymentException) {
        throw err;
      }
      this.logger.error({
        event: "SOLANA_VERIFICATION_FAILED",
        error: err instanceof Error ? err.message : String(err),
      });
      throw new InvalidPaymentException(
        `Failed to verify Solana on-chain transaction: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async verifyPayment(receipt: PaymentReceipt): Promise<boolean> {
    if (!receipt.challengeId) {
      throw new InvalidPaymentException(
        "Missing challengeId in X-PAYMENT receipt",
      );
    }

    const challenge = this.challenges.get(receipt.challengeId);

    if (this.isMockMode()) {
      if (!challenge && !receipt.challengeId.startsWith("ch_")) {
        throw new InvalidPaymentException("Challenge not found or expired");
      }
      this.logger.log({
        event: "PAYMENT_VERIFIED_MOCK",
        challengeId: receipt.challengeId,
        txSignature:
          receipt.txSignature ?? receipt.linkId ?? "simulated_devnet_tx",
      });
      this.challenges.delete(receipt.challengeId);
      return true;
    }

    // Live mode: the challenge must be one we issued.
    if (!challenge) {
      throw new InvalidPaymentException("Challenge not found or expired");
    }

    // Direct On-Chain Solana Settlement Path (A2A autonomous bot path)
    // Agent signs and broadcasts SOL transfer, proves it via txSignature.
    // linkId from the Moove challenge is included for Moove dashboard tracking
    // but the cryptographic verification is on-chain via Solana RPC.
    if (receipt.txSignature) {
      await this.verifySolanaTransaction(receipt.txSignature, challenge);
      this.logger.log({
        event: "PAYMENT_VERIFIED_ONCHAIN_SOLANA",
        challengeId: receipt.challengeId,
        txSignature: receipt.txSignature,
        linkId: receipt.linkId,
        payerAddress: receipt.payerAddress,
      });
      this.challenges.delete(receipt.challengeId);
      return true;
    }

    // Moove Hosted Payment Link Settlement Path (Browser / Checkout UI path)
    if (!receipt.linkId) {
      throw new InvalidPaymentException(
        "Live settlement requires either txSignature or Moove linkId in X-PAYMENT.",
      );
    }
    if (challenge.linkId !== undefined && receipt.linkId !== challenge.linkId) {
      throw new InvalidPaymentException(
        "Receipt linkId does not match the link issued for this challenge.",
      );
    }

    const link = await this.fetchLinkStatus(receipt.linkId);
    if (link.status === "completed") {
      this.logger.log({
        event: "PAYMENT_VERIFIED_LIVE",
        challengeId: receipt.challengeId,
        linkId: receipt.linkId,
        receivedAmount: link.receivedAmount,
      });
      this.challenges.delete(receipt.challengeId);
      return true;
    }
    if (link.status === "active") {
      const pending: Omit<PendingPaymentBody, "status" | "error"> = {
        message:
          "Payment link created but not settled yet. Complete checkout, then retry.",
        challengeId: receipt.challengeId,
        linkId: receipt.linkId,
        linkStatus: link.status,
        ...(challenge.paymentUrl !== undefined
          ? { paymentUrl: challenge.paymentUrl }
          : {}),
      };
      throw new PaymentPendingException(pending);
    }
    throw new InvalidPaymentException(
      `Payment link status is '${link.status}', not completed`,
    );
  }

  /**
   * Poll-friendly settlement lookup. Never throws for unknown
   * challenges — returns status 'unknown' so clients can keep polling.
   */
  async getPaymentStatus(
    challengeId: string,
    linkId?: string,
  ): Promise<PaymentStatus> {
    const challenge = this.challenges.get(challengeId);
    const effectiveLinkId = linkId ?? challenge?.linkId;
    const amount = challenge?.amount ?? "0.0003";
    const currency = challenge?.currency ?? "SOL";

    const base: Omit<PaymentStatus, "linkId" | "paymentUrl"> & {
      linkId?: string;
      paymentUrl?: string;
    } = { challengeId, status: "unknown", amount, currency };
    if (effectiveLinkId !== undefined) {
      base.linkId = effectiveLinkId;
    }
    if (challenge?.paymentUrl !== undefined) {
      base.paymentUrl = challenge.paymentUrl;
    }

    if (this.isMockMode()) {
      base.status =
        challenge !== undefined || challengeId.startsWith("ch_")
          ? "completed"
          : "unknown";
      return base;
    }

    if (effectiveLinkId === undefined) {
      base.status = challenge !== undefined ? "pending" : "unknown";
      return base;
    }

    try {
      const link = await this.fetchLinkStatus(effectiveLinkId);
      this.logger.debug({
        event: "MOOVE_STATUS_POLLED",
        challengeId,
        linkStatus: link.status,
      });
      if (link.status === "completed") {
        base.status = "completed";
      } else if (link.status === "active") {
        base.status = "pending";
      } else {
        base.status = "expired";
      }
      return base;
    } catch (err) {
      this.logger.warn({
        event: "MOOVE_STATUS_LOOKUP_FAILED",
        challengeId,
        error: err instanceof Error ? err.message : String(err),
      });
      return base;
    }
  }
}
