import { Type, type Static } from "@sinclair/typebox";

export const PaymentStatusQuerySchema = Type.Object({
  linkId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export type PaymentStatusQueryDto = Static<typeof PaymentStatusQuerySchema>;
