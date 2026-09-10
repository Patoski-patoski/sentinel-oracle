import { describe, it, expect, beforeEach } from "bun:test";
import { Reflector } from "@nestjs/core";
import { type ExecutionContext, HttpStatus } from "@nestjs/common";
import {
  X402PaymentGuard,
  type AuthenticatedPaymentRequest,
} from "../src/common/guards/x402-payment.guard.js";
import {
  MooveService,
  type MooveLinkStatusResponse,
} from "../src/moove/moove.service.js";
import { ConfigService } from "../src/config/config.service.js";
import { SessionPassService } from "../src/oracle/session-pass.service.js";
import {
  PaymentRequiredException,
  InvalidPaymentException,
  PaymentPendingException,
} from "../src/common/exceptions/payment-required.exception.js";
import { REQUIRE_PAYMENT_KEY } from "../src/common/decorators/require-payment.decorator.js";

/**
 * Live-mode MooveService with settlement states stubbed in-memory.
 * Overrides only the Moove API read — minting/verification logic runs for real.
 */
class StubSettledMooveService extends MooveService {
  constructor(
    configService: ConfigService,
    private readonly linkStates: Record<
      string,
      MooveLinkStatusResponse["status"]
    >,
  ) {
    super(configService);
  }

  override async fetchLinkStatus(
    linkId: string,
  ): Promise<MooveLinkStatusResponse> {
    const status = this.linkStates[linkId] ?? "active";
    return { id: linkId, url: `https://pay.moove.xyz/${linkId}`, status };
  }
}

function createLiveMooveService(
  linkStates: Record<string, MooveLinkStatusResponse["status"]> = {},
): MooveService {
  const prevKey = process.env["MOOVE_API_KEY"];
  process.env["MOOVE_API_KEY"] = "live-test-key";
  try {
    const configService = new ConfigService();
    return new StubSettledMooveService(configService, linkStates);
  } finally {
    if (prevKey === undefined) {
      delete process.env["MOOVE_API_KEY"];
    } else {
      process.env["MOOVE_API_KEY"] = prevKey;
    }
  }
}

describe("X402PaymentGuard", () => {
  let guard: X402PaymentGuard;
  let reflector: Reflector;
  let mooveService: MooveService;
  let configService: ConfigService;
  let sessionPassService: SessionPassService;

  beforeEach(() => {
    process.env["MOOVE_API_KEY"] = "mock";
    configService = new ConfigService();
    mooveService = new MooveService(configService);
    sessionPassService = new SessionPassService(configService);
    reflector = new Reflector();
    guard = new X402PaymentGuard(reflector, mooveService, sessionPassService);
  });

  function createMockContext(
    headers: Record<string, string | undefined>,
  ): ExecutionContext {
    const request = {
      url: "/api/v1/oracle/risk?target=MOON",
      headers,
    } as unknown as AuthenticatedPaymentRequest;

    const response = {
      setHeader: () => response,
    };

    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  }

  it("allows request if endpoint does not require payment", async () => {
    reflector.getAllAndOverride = () => undefined;
    const ctx = createMockContext({});
    const canActivate = await guard.canActivate(ctx);
    expect(canActivate).toBe(true);
  });

  it("throws PaymentRequiredException (HTTP 402) when X-PAYMENT header is missing", async () => {
    reflector.getAllAndOverride = (key: unknown) => {
      if (key === REQUIRE_PAYMENT_KEY) {
        return { amount: "0.0003", currency: "SOL" };
      }
      return undefined;
    };

    const ctx = createMockContext({});
    try {
      await guard.canActivate(ctx);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err instanceof PaymentRequiredException).toBe(true);
      const ex = err as PaymentRequiredException;
      expect(ex.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      expect(ex.challenge.amount).toBe("0.0003");
      expect(ex.challenge.currency).toBe("SOL");
      expect(ex.challenge.challengeId.startsWith("ch_")).toBe(true);
    }
  });

  it("throws InvalidPaymentException if X-PAYMENT header is malformed JSON", async () => {
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const ctx = createMockContext({ "x-payment": "not-valid-json" });

    try {
      await guard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof InvalidPaymentException).toBe(true);
    }
  });

  it("allows request when valid receipt is provided", async () => {
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const challenge = await mooveService.createChallenge("0.0003", "SOL");
    const receipt = {
      challengeId: challenge.challengeId,
      txSignature: "5K9xDevnetSignatureForTest123456789",
    };

    const ctx = createMockContext({ "x-payment": JSON.stringify(receipt) });
    const canActivate = await guard.canActivate(ctx);
    expect(canActivate).toBe(true);
  });

  it("live mode: rejects invented tx signatures with no linkId", async () => {
    const liveService = createLiveMooveService();
    const liveGuard = new X402PaymentGuard(
      reflector,
      liveService,
      sessionPassService,
    );
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const challenge = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/test",
      "link_live_1",
    );

    const ctx = createMockContext({
      "x-payment": JSON.stringify({
        challengeId: challenge.challengeId,
        txSignature: "5K9xInventedSignature9999",
      }),
    });
    try {
      await liveGuard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof InvalidPaymentException).toBe(true);
    }
  });

  it("live mode: rejects receipts for unknown challenges", async () => {
    const liveService = createLiveMooveService();
    const liveGuard = new X402PaymentGuard(
      reflector,
      liveService,
      sessionPassService,
    );
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });

    const ctx = createMockContext({
      "x-payment": JSON.stringify({
        challengeId: "ch_unknown_xyz",
        linkId: "link_x",
      }),
    });
    try {
      await liveGuard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof InvalidPaymentException).toBe(true);
    }
  });

  it("live mode: allows request when the Moove link is completed", async () => {
    const liveService = createLiveMooveService({ link_live_paid: "completed" });
    const liveGuard = new X402PaymentGuard(
      reflector,
      liveService,
      sessionPassService,
    );
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const challenge = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/test",
      "link_live_paid",
    );

    const ctx = createMockContext({
      "x-payment": JSON.stringify({
        challengeId: challenge.challengeId,
        linkId: "link_live_paid",
      }),
    });
    const canActivate = await liveGuard.canActivate(ctx);
    expect(canActivate).toBe(true);
  });

  it("live mode: surfaces HTTP 202 while the link is still active", async () => {
    const liveService = createLiveMooveService({ link_live_wait: "active" });
    const liveGuard = new X402PaymentGuard(
      reflector,
      liveService,
      sessionPassService,
    );
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const challenge = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/test",
      "link_live_wait",
    );

    const ctx = createMockContext({
      "x-payment": JSON.stringify({
        challengeId: challenge.challengeId,
        linkId: "link_live_wait",
      }),
    });
    try {
      await liveGuard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof PaymentPendingException).toBe(true);
      expect((err as PaymentPendingException).getStatus()).toBe(
        HttpStatus.ACCEPTED,
      );
    }
  });

  it("live mode: rejects a completed link minted for a different challenge", async () => {
    const liveService = createLiveMooveService({
      link_other_challenge: "completed",
    });
    const liveGuard = new X402PaymentGuard(
      reflector,
      liveService,
      sessionPassService,
    );
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const challenge = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/test",
      "link_this_challenge",
    );

    const ctx = createMockContext({
      "x-payment": JSON.stringify({
        challengeId: challenge.challengeId,
        linkId: "link_other_challenge",
      }),
    });
    try {
      await liveGuard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof InvalidPaymentException).toBe(true);
    }
  });

  it("live mode: accepts txSignature with linkId from Moove challenge (agent flow)", async () => {
    const liveService = createLiveMooveService();
    // Stub Solana RPC verification to simulate a successful on-chain settlement
    liveService.verifySolanaTransaction = async () => true;
    const liveGuard = new X402PaymentGuard(
      reflector,
      liveService,
      sessionPassService,
    );
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const challenge = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/test",
      "link_agent_1",
    );

    const ctx = createMockContext({
      "x-payment": JSON.stringify({
        challengeId: challenge.challengeId,
        txSignature: "5K9xAgentRealDevnetSig12345678901234567890",
        payerAddress: "AgentWalletPublicKey11111111111111111111111111",
        linkId: "link_agent_1",
      }),
    });
    const canActivate = await liveGuard.canActivate(ctx);
    expect(canActivate).toBe(true);
  });

  it("live mode: txSignature takes priority over linkId verification", async () => {
    const liveService = createLiveMooveService({ link_stale: "active" });
    // On-chain verification succeeds even though the Moove link is still active
    liveService.verifySolanaTransaction = async () => true;
    const liveGuard = new X402PaymentGuard(
      reflector,
      liveService,
      sessionPassService,
    );
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const challenge = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/test",
      "link_stale",
    );

    const ctx = createMockContext({
      "x-payment": JSON.stringify({
        challengeId: challenge.challengeId,
        txSignature: "5K9xAgentSettledOnChain123456789012345678",
        linkId: "link_stale",
      }),
    });
    const canActivate = await liveGuard.canActivate(ctx);
    expect(canActivate).toBe(true);
  });

  it("live mode: reports pending/completed through getPaymentStatus", async () => {
    const liveService = createLiveMooveService({
      link_live_wait: "active",
      link_live_paid: "completed",
    });
    const waiting = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/w",
      "link_live_wait",
    );
    const paid = liveService.mintChallenge(
      "0.0003",
      "SOL",
      "https://pay.moove.xyz/p",
      "link_live_paid",
    );

    const pendingStatus = await liveService.getPaymentStatus(
      waiting.challengeId,
    );
    expect(pendingStatus.status).toBe("pending");
    expect(pendingStatus.linkId).toBe("link_live_wait");

    const completedStatus = await liveService.getPaymentStatus(
      paid.challengeId,
      "link_live_paid",
    );
    expect(completedStatus.status).toBe("completed");

    const unknownStatus = await liveService.getPaymentStatus("ch_nope_missing");
    expect(unknownStatus.status).toBe("unknown");
  });

  it("session pass: allows immediate access and decrements remaining quota", async () => {
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });
    const sessionToken = sessionPassService.generateToken(
      "TestPayerAddress111",
      5,
    );

    const ctx = createMockContext({
      "x-session-token": sessionToken,
    });

    const canActivate = await guard.canActivate(ctx);
    expect(canActivate).toBe(true);

    const status = sessionPassService.getStatus(sessionToken);
    expect(status?.remaining).toBe(4);
  });

  it("session pass: rejects corrupted or expired session token", async () => {
    reflector.getAllAndOverride = () => ({ amount: "0.0003", currency: "SOL" });

    const ctx = createMockContext({
      "x-session-token": "corrupted_token_string_123",
    });

    try {
      await guard.canActivate(ctx);
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof InvalidPaymentException).toBe(true);
    }
  });

  it("session pass: pruneExpired cleans up expired and exhausted passes", async () => {
    // Generate an already-expired pass (TTL = -1000ms)
    sessionPassService.generateToken("PayerExpired", 10, -1000);

    // Prune should find and delete it
    const prunedCount = sessionPassService.pruneExpired();
    expect(prunedCount).toBeGreaterThanOrEqual(1);

    // Clean up timer
    sessionPassService.onModuleDestroy();
  });
});
