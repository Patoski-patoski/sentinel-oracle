import { Type, type Static } from "@sinclair/typebox";

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
