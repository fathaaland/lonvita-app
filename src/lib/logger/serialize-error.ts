export type SerializedError = {
  errorName?: string
  errorMessage: string
  errorStack?: string
  errorCause?: SerializedError
}

const MAX_MESSAGE_LENGTH = 2_000
const MAX_CAUSE_DEPTH = 3

/**
 * A failed Drizzle query reads `Failed query: <sql>\nparams: <values>` — and the values are what
 * the row was about to hold: e-mail addresses, names, phone numbers. The SQL is what identifies
 * the failure; the values only put personal data into a third party's log storage.
 */
const redactMessage = (message: string): string =>
  message.replace(/\nparams: [\s\S]*$/, '\nparams: [redacted]').slice(0, MAX_MESSAGE_LENGTH)

/**
 * Prefixed keys, not `name`/`message`/`stack`: these objects are spread straight into a log
 * context, and the log envelope itself owns `message` — an error serialised into a bare
 * `message` field would be silently overwritten by the line's own text on the way out.
 */
export const serializeError = (error: unknown, depth = 0): SerializedError => {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: redactMessage(error.message),
      // A stack in production log storage is a liability more than a help for handled errors;
      // the message plus the correlationId is enough to find the request.
      ...(process.env.NODE_ENV === 'production' ? {} : { errorStack: error.stack }),
      // The wrapper often says the least: a failed query's cause is the database's own reason
      // (a violated constraint, a missing column), which the wrapper's message leaves out.
      ...(error.cause !== undefined && depth < MAX_CAUSE_DEPTH
        ? { errorCause: serializeError(error.cause, depth + 1) }
        : {}),
    }
  }
  return { errorMessage: redactMessage(String(error)) }
}
