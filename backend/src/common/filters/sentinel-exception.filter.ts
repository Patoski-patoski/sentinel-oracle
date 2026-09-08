import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { PaymentRequiredException } from "../exceptions/payment-required.exception.js";
import { SentinelException } from "../exceptions/base.exception.js";

@Catch()
export class SentinelExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentinelExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof PaymentRequiredException) {
      response.setHeader("X-Payment-Required", "true");
      response.setHeader("X-Payment-Protocol", "moove-x402-v1");
      response
        .status(HttpStatus.PAYMENT_REQUIRED)
        .json(exception.getResponse());
      return;
    }

    if (exception instanceof SentinelException) {
      this.logger.warn({
        event: "SENTINEL_EXCEPTION",
        code: exception.code,
        message: exception.message,
        context: exception.context,
      });
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const errorMsg =
      exception instanceof Error ? exception.message : "Internal server error";
    this.logger.error({
      event: "UNHANDLED_EXCEPTION",
      error: errorMsg,
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_SERVER_ERROR",
      message: errorMsg,
    });
  }
}
