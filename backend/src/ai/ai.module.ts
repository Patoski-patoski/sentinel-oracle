import { Module } from "@nestjs/common";
import { RiskReasonerService } from "./risk-reasoner.service.js";
import { ConfigService } from "../config/config.service.js";

@Module({
  providers: [RiskReasonerService, ConfigService],
  exports: [RiskReasonerService],
})
export class AiModule {}
