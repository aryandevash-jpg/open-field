import { Prisma } from "../generated/prisma/client.js";

// Shared helpers for reading PostgreSQL details out of Prisma errors.
//
// With @prisma/adapter-pg, database errors Prisma has no code for arrive as
// PrismaClientKnownRequestError (P2039 for model queries, P2010 for $queryRaw)
// carrying the PostgreSQL SQLSTATE and message in
// meta.driverAdapterError.cause.{originalCode, originalMessage}.

// Returns the PostgreSQL message of a check_violation (23514), if that is what
// the driver adapter reported.
export const checkViolationMessage = (
  error: Prisma.PrismaClientKnownRequestError
): string | undefined => {
  const adapterError = error.meta?.driverAdapterError;
  if (typeof adapterError !== "object" || adapterError === null || !("cause" in adapterError)) {
    return undefined;
  }

  const { cause } = adapterError;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "originalCode" in cause &&
    "originalMessage" in cause &&
    cause.originalCode === "23514" &&
    typeof cause.originalMessage === "string"
  ) {
    return cause.originalMessage;
  }

  return undefined;
};
