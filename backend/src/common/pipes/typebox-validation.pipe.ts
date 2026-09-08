import { PipeTransform, BadRequestException, Injectable } from "@nestjs/common";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

@Injectable()
export class TypeBoxValidationPipe<T extends TSchema> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): unknown {
    const errors = [...Value.Errors(this.schema, value)];
    if (errors.length > 0) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: errors.map((e) => ({
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      });
    }
    return Value.Cast(this.schema, value);
  }
}
