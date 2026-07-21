const INVALID_SESSION_MESSAGE = "INVALID_SESSION";
const INVALID_SESSION_SQLSTATE = "P0001";

/**
 * Distinguishes a server-confirmed invalid/expired/revoked/inactive session
 * (the literal error raised by get_valid_employee_session_context-guarded
 * RPCs, via `raise exception using errcode = 'P0001', message =
 * 'INVALID_SESSION'`) from ordinary network/infrastructure failures or
 * unrelated database errors, which must not be treated as session
 * expiration.
 *
 * Checks both the agreed message and the SQLSTATE PostgREST surfaces as
 * `code` on the error object, since P0001 alone is Postgres's generic
 * "raise_exception" code and isn't unique to this condition.
 */
export function isInvalidSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; code?: unknown };
  return (
    candidate.message === INVALID_SESSION_MESSAGE && candidate.code === INVALID_SESSION_SQLSTATE
  );
}
