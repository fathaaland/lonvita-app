export type SerializedError = {
  name?: string
  message: string
  stack?: string
}

export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      // A stack in production log storage is a liability more than a help for handled errors;
      // the message plus the correlationId is enough to find the request.
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: error.stack }),
    }
  }
  return { message: String(error) }
}
