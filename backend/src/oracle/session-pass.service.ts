import { Injectable, Logger } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { ConfigService } from "../config/config.service.js";

// ─── Exported Interfaces & Types ─────────────────────────────────────────────

export interface SessionPassPayload {
  passId: string;
  payerAddress: string;
  issuedAt: number; // Unix epoch ms
  expiresAt: number; // Unix epoch ms
  maxQueries: number;
}

export interface SessionPassToken {
  payload: SessionPassPayload;
  signature: string;
}

export type SessionPassValidation =
  | { valid: true; passId: string; remaining: number; expiresAt: number }
  | { valid: false; reason: string };

export interface SessionPassStatus {
  passId: string;
  payerAddress: string;
  remaining: number;
  maxQueries: number;
  expiresAt: string; // ISO string
  isExpired: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_QUERIES = 100;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Type Guards ─────────────────────────────────────────────────────────────

function isSessionPassPayload(value: unknown): value is SessionPassPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["passId"] === "string" &&
    typeof obj["payerAddress"] === "string" &&
    typeof obj["issuedAt"] === "number" &&
    typeof obj["expiresAt"] === "number" &&
    typeof obj["maxQueries"] === "number"
  );
}

function isSessionPassToken(value: unknown): value is SessionPassToken {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    isSessionPassPayload(obj["payload"]) && typeof obj["signature"] === "string"
  );
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class SessionPassService {
  private readonly logger = new Logger(SessionPassService.name);
  private readonly hmacSecret: string;

  /**
   * In-memory quota tracker.
   * Key: passId → number of queries already consumed.
   */
  private readonly consumed = new Map<string, number>();

  constructor(private readonly configService: ConfigService) {
    this.hmacSecret =
      this.configService.get("SESSION_PASS_SECRET") ??
      "sentinel-session-secret-dev";
    this.logger.log({ event: "SESSION_PASS_SERVICE_INITIALIZED" });
  }

  // ─── Token Generation ────────────────────────────────────────────────────

  /**
   * Issue a new session pass token for `payerAddress`.
   */
  generateToken(
    payerAddress: string,
    maxQueries: number = DEFAULT_MAX_QUERIES,
    ttlMs: number = DEFAULT_TTL_MS,
  ): string {
    const now = Date.now();
    const payload: SessionPassPayload = {
      passId: randomUUID(),
      payerAddress,
      issuedAt: now,
      expiresAt: now + ttlMs,
      maxQueries,
    };

    const signature = this.sign(payload);
    const token: SessionPassToken = { payload, signature };

    // Initialise quota tracking
    this.consumed.set(payload.passId, 0);

    this.logger.log({
      event: "SESSION_PASS_ISSUED",
      passId: payload.passId,
      payerAddress,
      maxQueries,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    });

    return this.encode(token);
  }

  // ─── Token Validation ────────────────────────────────────────────────────

  /**
   * Validate a Base64-encoded session pass token without consuming a query.
   */
  validateToken(tokenString: string): SessionPassValidation {
    const parsed = this.decode(tokenString);
    if (!parsed) {
      return { valid: false, reason: "Malformed or unreadable token" };
    }

    if (!this.verifySignature(parsed)) {
      return { valid: false, reason: "Invalid HMAC signature" };
    }

    const { payload } = parsed;

    if (Date.now() > payload.expiresAt) {
      return { valid: false, reason: "Session pass expired" };
    }

    const used = this.consumed.get(payload.passId) ?? 0;
    const remaining = payload.maxQueries - used;

    if (remaining <= 0) {
      return { valid: false, reason: "Query quota exhausted" };
    }

    return {
      valid: true,
      passId: payload.passId,
      remaining,
      expiresAt: payload.expiresAt,
    };
  }

  // ─── Quota Consumption ───────────────────────────────────────────────────

  /**
   * Consume one query from the session pass.
   * Returns `{ valid: true, remaining }` on success, or `{ valid: false, reason }`.
   */
  consumeQuery(tokenString: string): SessionPassValidation {
    const parsed = this.decode(tokenString);
    if (!parsed) {
      return { valid: false, reason: "Malformed or unreadable token" };
    }

    if (!this.verifySignature(parsed)) {
      return { valid: false, reason: "Invalid HMAC signature" };
    }

    const { payload } = parsed;

    if (Date.now() > payload.expiresAt) {
      this.logger.warn({
        event: "SESSION_PASS_EXPIRED_CONSUMPTION",
        passId: payload.passId,
      });
      return { valid: false, reason: "Session pass expired" };
    }

    // Atomic increment — single-threaded JS guarantees no race conditions
    const used = this.consumed.get(payload.passId) ?? 0;
    if (used >= payload.maxQueries) {
      this.logger.warn({
        event: "SESSION_PASS_QUOTA_EXHAUSTED",
        passId: payload.passId,
      });
      return { valid: false, reason: "Query quota exhausted" };
    }

    const newUsed = used + 1;
    this.consumed.set(payload.passId, newUsed);
    const remaining = payload.maxQueries - newUsed;

    this.logger.log({
      event: "SESSION_PASS_QUERY_CONSUMED",
      passId: payload.passId,
      queriesUsed: newUsed,
      remaining,
    });

    return {
      valid: true,
      passId: payload.passId,
      remaining,
      expiresAt: payload.expiresAt,
    };
  }

  // ─── Status Query ────────────────────────────────────────────────────────

  /**
   * Retrieve status information for a session pass token.
   * Returns `null` if the token is invalid.
   */
  getStatus(tokenString: string): SessionPassStatus | null {
    const parsed = this.decode(tokenString);
    if (!parsed) return null;

    if (!this.verifySignature(parsed)) return null;

    const { payload } = parsed;
    const used = this.consumed.get(payload.passId) ?? 0;

    return {
      passId: payload.passId,
      payerAddress: payload.payerAddress,
      remaining: Math.max(0, payload.maxQueries - used),
      maxQueries: payload.maxQueries,
      expiresAt: new Date(payload.expiresAt).toISOString(),
      isExpired: Date.now() > payload.expiresAt,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /** Compute HMAC-SHA256 over the canonical JSON of the payload. */
  private sign(payload: SessionPassPayload): string {
    return createHmac("sha256", this.hmacSecret)
      .update(this.canonicalize(payload))
      .digest("hex");
  }

  /** Verify a token's HMAC signature against its payload. */
  private verifySignature(token: SessionPassToken): boolean {
    const expected = this.sign(token.payload);
    // Constant-time-ish comparison via HMAC to avoid timing attacks
    const a = createHmac("sha256", this.hmacSecret)
      .update(expected)
      .digest("hex");
    const b = createHmac("sha256", this.hmacSecret)
      .update(token.signature)
      .digest("hex");
    return a === b;
  }

  /** Deterministic JSON serialisation for HMAC input. */
  private canonicalize(payload: SessionPassPayload): string {
    return JSON.stringify({
      passId: payload.passId,
      payerAddress: payload.payerAddress,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      maxQueries: payload.maxQueries,
    });
  }

  /** Encode a SessionPassToken to a Base64 string. */
  private encode(token: SessionPassToken): string {
    const json = JSON.stringify(token);
    return Buffer.from(json, "utf-8").toString("base64");
  }

  /** Decode a Base64 string back to a SessionPassToken, or null on failure. */
  private decode(tokenString: string): SessionPassToken | null {
    try {
      const json = Buffer.from(tokenString, "base64").toString("utf-8");
      const parsed: unknown = JSON.parse(json);
      if (isSessionPassToken(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
}
