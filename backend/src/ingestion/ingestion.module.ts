import { Module } from "@nestjs/common";
import { SolanaIngestionService } from "./solana-ingestion.service.js";
import { DatabaseModule } from "../database/database.module.js";
import { ConfigService } from "../config/config.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [SolanaIngestionService, ConfigService],
  exports: [SolanaIngestionService],
})
export class IngestionModule {}
