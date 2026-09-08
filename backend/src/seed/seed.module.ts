import { Module } from "@nestjs/common";
import { SeedService } from "./seed.service.js";
import { DatabaseModule } from "../database/database.module.js";

@Module({
  imports: [DatabaseModule],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
