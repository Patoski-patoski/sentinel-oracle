import { Type, type Static } from "@sinclair/typebox";

export const EnvSchema = Type.Object({
  PORT: Type.Optional(Type.String({ default: "3000" })),
  COGNO_DB_URI: Type.Optional(Type.String()),
  COGNODB_URI: Type.Optional(Type.String()),
  COGNO_DB_USER: Type.Optional(Type.String()),
  COGNODB_USER: Type.Optional(Type.String()),
  COGNO_DB_PASSWORD: Type.Optional(Type.String()),
  COGNODB_PASSWORD: Type.Optional(Type.String()),
  COGNO_DB_DATABASE: Type.Optional(Type.String({ default: "neo4j" })),
  COGNODB_DATABASE: Type.Optional(Type.String()),
  CORS_ORIGIN: Type.Optional(Type.String()),
  MOOVE_API_KEY: Type.Optional(Type.String({ default: "mock" })),
  MOOVE_API_BASE_URL: Type.Optional(
    Type.String({ default: "https://api.moove.xyz" }),
  ),
  MOOVE_RECIPIENT_HANDLE: Type.Optional(
    Type.String({ default: "sentinel.moove" }),
  ),
  MOOVE_TREASURY_ADDRESS: Type.Optional(
    Type.String({
      default: "G7Vh9sJzWtjX3H1QdGWBCUWhZxoEVrBVmYGz27gSUnLj",
    }),
  ),
  OPENAI_API_KEY: Type.Optional(Type.String()),
  OPENAI_MODEL: Type.Optional(Type.String({ default: "gpt-4o-mini" })),
  GEMINI_API_KEY: Type.Optional(Type.String()),
  GEMINI_MODEL: Type.Optional(Type.String({ default: "gemini-2.5-flash" })),
  SOLANA_RPC_URL: Type.Optional(
    Type.String({ default: "https://api.devnet.solana.com" }),
  ),
});

export type EnvConfig = Static<typeof EnvSchema>;
