# AGENTS.MD — Sentinel: The Agent-to-Agent x402 Risk Oracle

This file defines the architecture, rules, conventions, and implementation guidelines for the **Sentinel** full-stack monorepo (`backend`, `frontend`, `client-agent`). Read this entire file before writing, editing, or reviewing any code in this project.

---

## Project Overview

**Sentinel** is an autonomous On-Chain Risk Oracle for AI Trading Agents. It analyzes DeFi transaction graphs to detect:

1. **Circular Wash-Trading Loops** (variable 2..6 hops cycling artificial volume)
2. **Sybil Sniping Bot Farms** (mastermind wallets funding clusters to snipe liquidity)
3. **Laundering Peeling Chains** (rapid successive splits ending in exchange deposit addresses)

### Architecture & Settlement Layer

- **Database:** CognoDB Cloud (managed openCypher graph database via official `neo4j-driver`)
- **Backend Framework:** NestJS with strict TypeScript
- **Runtime:** Bun
- **Settlement Rails:** HTTP 402 "Payment Required" micro-transactions via **Moove Agentic Payments** ($0.05 USDC per query)
- **AI Reasoning Engine:** Structured LLM synthesizer contextualizing raw graph telemetry into actionable trade verdicts
- **Frontend:** React + Vite + Tailwind CSS (Interactive Judge Simulator, Telemetry Stream & Risk Radar)
- **Client Agent:** Autonomous CLI trading bot showing automated machine-to-machine 402 challenge negotiation and settlement

---

## TypeScript Rules

### 1. No `any` — Ever

`any` is strictly prohibited throughout the codebase without exception.

```typescript
// ❌ Strictly banned
function analyzeRisk(data: any) {}

// ✅ Use explicit types or unknown with type guards
function analyzeRisk(data: RiskQueryDto): RiskVerdict {}
```

If the shape of incoming data is uncertain (such as raw Neo4j record structures), use `unknown` and narrow with explicit type guards:

```typescript
export function isNeo4jInteger(
  value: unknown,
): value is { toNumber: () => number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as Record<string, unknown>)["toNumber"] === "function"
  );
}
```

### 2. Strict TypeScript Config

Every `tsconfig.json` must enforce:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true
  }
}
```

---

## Validation — TypeBox Only

All DTOs, query parameters, headers, and environment variables MUST be validated using **TypeBox** (`@sinclair/typebox`).
Do NOT use `class-validator` or `zod`.

### DTO Example

```typescript
import { Type, Static } from "@sinclair/typebox";

export const RiskQuerySchema = Type.Object({
  target: Type.String({
    minLength: 1,
    maxLength: 64,
    description: "Token symbol or mint address",
  }),
  type: Type.Optional(
    Type.Union([Type.Literal("TOKEN"), Type.Literal("WALLET")], {
      default: "TOKEN",
    }),
  ),
  minAmount: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
});

export type RiskQueryDto = Static<typeof RiskQuerySchema>;
```

### TypeBox Validation Pipe

Controllers must use `TypeBoxValidationPipe` to validate incoming requests:

```typescript
import { PipeTransform, BadRequestException } from "@nestjs/common";
import { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export class TypeBoxValidationPipe<T extends TSchema> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown) {
    const errors = [...Value.Errors(this.schema, value)];
    if (errors.length > 0) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: errors.map((e) => ({
          path: e.path,
          message: e.message,
        })),
      });
    }
    return Value.Cast(this.schema, value);
  }
}
```

---

## The x402 Protocol & Moove Integration

### 1. The HTTP 402 Challenge

When an endpoint marked with `@RequirePayment()` receives a request without a valid payment receipt, `X402PaymentGuard` halts execution and throws `PaymentRequiredException`, generating:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
X-Payment-Required: true
X-Payment-Protocol: moove-x402-v1

{
  "status": 402,
  "error": "Payment Required",
  "message": "Autonomous Risk Assessment requires an on-chain micro-payment.",
  "challenge": {
    "challengeId": "ch_984f1a20c3",
    "amount": "0.05",
    "currency": "USDC",
    "network": "solana-devnet",
    "recipient": "sentinel.moove",
    "paymentUrl": "https://pay.moove.xyz/l/...",
    "instructions": {
      "headerName": "X-PAYMENT",
      "format": "JSON { challengeId, txSignature, payerAddress }"
    }
  }
}
```

### 2. Moove Service Rules

- **Decimal Strings for Money:** Always pass `toAmount` as a string (`"0.05"`, never `0.05`).
- **Reference Identifier:** Always supply a reference identifier in `description` matching the `challengeId`.
- **Payment Link Verification:** To verify settlement, query `$MOOVE_API_BASE_URL/v1/payment-link/{id}` and inspect `status === 'completed'`.
- **Devnet / Sandbox Mode:** When running in local development or if `MOOVE_API_KEY` is not set or set to `mock`, provide an explicit sandbox bypass for local testing while logging a clear warning.

---

## CognoDB & openCypher Conventions

1. **Parameterize all queries:** NEVER interpolate variables into Cypher query strings.
   ```typescript
   // ❌ BAD
   const query = `MATCH (t:Token {symbol: '${symbol}'}) RETURN t`;

   // ✅ GOOD
   const query = `MATCH (t:Token {symbol: $symbol}) RETURN t`;
   await session.run(query, { symbol });
   ```
2. **Session Lifecycle:** Always wrap Cypher executions in `try / finally` to ensure `session.close()` is guaranteed, or use managed transaction blocks.
3. **CognoDB Driver:** Use official `neo4j-driver` Bolt protocol pointing to `COGNO_DB_URI`.
4. **Resilience:** Catch connectivity exceptions (`ServiceUnavailable`, `Neo4jError`) and surface `DatabaseConnectionException` with actionable diagnostic information.

---

## Custom Exception Hierarchy

```markdown
src/common/exceptions/
├── base.exception.ts
├── database.exception.ts
└── payment-required.exception.ts
```

```typescript
export interface ExceptionMeta {
  code: string;
  detail?: string;
  context?: Record<string, unknown>;
}

export class SentinelException extends HttpException {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(meta: ExceptionMeta, status: HttpStatus) {
    super({ message: meta.detail ?? meta.code, code: meta.code }, status);
    this.code = meta.code;
    this.context = meta.context ?? {};
  }
}
```

---

## Monorepo Directory Layout

```markdown
sentinel-oracle/
├── backend/
│ ├── src/
│ │ ├── ai/
│ │ ├── common/ (guards, decorators, filters, pipes, exceptions)
│ │ ├── config/
│ │ ├── database/
│ │ ├── moove/
│ │ ├── oracle/
│ │ ├── seed/
│ │ ├── app.module.ts
│ │ └── main.ts
│ ├── package.json
│ └── tsconfig.json
├── client-agent/
│ ├── demo-trader-bot.ts
│ ├── package.json
│ └── tsconfig.json
├── frontend/
│ ├── src/
│ │ ├── components/
│ │ ├── App.tsx
│ │ └── main.tsx
│ ├── package.json
│ └── vite.config.ts
├── .husky/
├── commitlint.config.js
├── AGENTS.md
├── SENTINEL_BLUEPRINT.md
└── package.json
```

---

## Logging & Code Quality

- Use NestJS `Logger`. Never use `console.log` in backend services.
- Conventional commits enforced via `@commitlint/config-conventional`.
- Pre-commit hooks run `lint-staged`.
- Unit tests cover query builders, x402 guard flows, and response serialization.
