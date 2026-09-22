/**
 * Prefixed keys, not `name`/`message`/`stack`: these objects are spread straight into a log
 * context, and the log envelope itself owns `message` — an error serialised into a bare
 * `message` field would be silently overwritten by the line's own text on the way out.
 */
export const serializeError = (error) => {
    if (error instanceof Error) {
        return {
            errorName: error.name,
            errorMessage: error.message,
            // A stack in production log storage is a liability more than a help for handled errors;
            // the message plus the correlationId is enough to find the request.
            ...(process.env.NODE_ENV === 'production' ? {} : { errorStack: error.stack }),
        };
    }
    return { errorMessage: String(error) };
};
