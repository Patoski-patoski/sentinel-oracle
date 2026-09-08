import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { ConfigService } from "./config/config.service.js";

async function bootstrap(): Promise<void> {
  const logger = new Logger("SentinelBootstrap");
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: "*",
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      exposedHeaders: ["X-Payment-Required", "X-Payment-Protocol"],
    },
  });

  const configService = app.get(ConfigService);
  const port = parseInt(configService.get("PORT") ?? "3000", 10);

  await app.listen(port);
  logger.log(`🛡️ Sentinel Oracle is live on port http://localhost:${port}`);
  logger.log(`💳 x402 Payment Rails: Active ($0.0003 SOL / query via Moove)`);
  logger.log(
    `📊 Endpoint: http://localhost:${port}/api/v1/oracle/risk?target=MOON&type=TOKEN`,
  );
}

bootstrap().catch((err: unknown) => {
  const errorMsg =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  new Logger("SentinelBootstrap").error(
    `Failed to start Sentinel backend: ${errorMsg}`,
  );
  process.exit(1);
});
