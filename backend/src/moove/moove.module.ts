import { Module } from "@nestjs/common";
import { MooveService } from "./moove.service.js";
import { ConfigService } from "../config/config.service.js";

@Module({
  providers: [MooveService, ConfigService],
  exports: [MooveService],
})
export class MooveModule {}
