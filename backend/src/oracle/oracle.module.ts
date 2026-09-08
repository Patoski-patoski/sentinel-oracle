import { Module } from "@nestjs/common";
import { OracleController } from "./oracle.controller.js";
import { OracleService } from "./oracle.service.js";
import { DatabaseModule } from "../database/database.module.js";
import { AiModule } from "../ai/ai.module.js";
import { MooveModule } from "../moove/moove.module.js";
import { SeedModule } from "../seed/seed.module.js";
import { ConfigService } from "../config/config.service.js";

@Module({
  imports: [DatabaseModule, AiModule, MooveModule, SeedModule],
  controllers: [OracleController],
  providers: [OracleService, ConfigService],
  exports: [OracleService],
})
export class OracleModule {}
