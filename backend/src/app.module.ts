import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigService } from "./config/config.service.js";
import { DatabaseModule } from "./database/database.module.js";
import { MooveModule } from "./moove/moove.module.js";
import { AiModule } from "./ai/ai.module.js";
import { OracleModule } from "./oracle/oracle.module.js";
import { SeedModule } from "./seed/seed.module.js";
import { IngestionModule } from "./ingestion/ingestion.module.js";
import { SentinelExceptionFilter } from "./common/filters/sentinel-exception.filter.js";

@Module({
  imports: [
    DatabaseModule,
    MooveModule,
    AiModule,
    OracleModule,
    SeedModule,
    IngestionModule,
  ],
  providers: [
    ConfigService,
    {
      provide: APP_FILTER,
      useClass: SentinelExceptionFilter,
    },
  ],
})
export class AppModule {}
