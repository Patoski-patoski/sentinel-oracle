import { HttpException, HttpStatus } from "@nestjs/common";

export interface ExceptionMeta {
  code: string;
  detail?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

export class SentinelException extends HttpException {
  public readonly code: string;
  public readonly context: Record<string, unknown>;

  constructor(
    meta: ExceptionMeta,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super(
      {
        status,
        code: meta.code,
        message: meta.detail ?? meta.code,
        context: meta.context ?? {},
      },
      status,
    );
    this.code = meta.code;
    this.context = meta.context ?? {};
  }
}
