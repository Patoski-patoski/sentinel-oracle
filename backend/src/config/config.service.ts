import { Injectable, Logger } from "@nestjs/common";
import { Value } from "@sinclair/typebox/value";
import { EnvSchema, type EnvConfig } from "./env.schema.js";
import * as dotenv from "dotenv";
import { resolve } from "path";
import * as fs from "fs";

const backendEnvPath = resolve(process.cwd(), "backend/.env");
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else {
  dotenv.config();
}

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly config: EnvConfig;

  constructor() {
    const rawEnv = process.env;
    const errors = [...Value.Errors(EnvSchema, rawEnv)];
    if (errors.length > 0) {
      this.logger.error({
        event: "ENV_VALIDATION_FAILED",
        errors: errors.map((e) => ({ path: e.path, message: e.message })),
      });
      throw new Error("Invalid environment configuration");
    }
    // Snapshot the validated env: Value.Cast mutates/returns its input by
    // reference, so without a copy this.config would stay aliased to the
    // live process.env object and any later mutation would leak into config.
    this.config = { ...Value.Cast(EnvSchema, rawEnv) };
  }

  get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
    return this.config[key];
  }
}
