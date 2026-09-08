import { Module } from "@nestjs/common";
import { CognoDBService } from "./cognoDB.service.js";
import { ConfigService } from "../config/config.service.js";

@Module({
  providers: [CognoDBService, ConfigService],
  exports: [CognoDBService],
})
export class DatabaseModule {}
