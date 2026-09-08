import { HttpStatus } from "@nestjs/common";
import { SentinelException } from "./base.exception.js";

export class DatabaseConnectionException extends SentinelException {
  constructor(
    detail = "Failed to establish connection to CognoDB graph database",
    context?: Record<string, unknown>,
  ) {
    super(
      {
        code: "COGNO_DB_CONNECTION_ERROR",
        detail,
        context,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class QueryExecutionException extends SentinelException {
  constructor(
    queryName: string,
    detail: string,
    context?: Record<string, unknown>,
  ) {
    super(
      {
        code: "COGNO_DB_QUERY_ERROR",
        detail: `Failed to execute Cypher query [${queryName}]: ${detail}`,
        context,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
