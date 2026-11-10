// Prints the shape of the database URLs the build sees — never the password. For a build that fails
// with "ENOTFOUND base" (pg-connection-string reads an empty or malformed URL as host "base").
for (const name of ['DATABASE_URI_MIGRATE', 'DATABASE_URI']) {
  const value = process.env[name]
  if (value === undefined) {
    console.log(`db-url-shape: ${name} is not set`)
    continue
  }
  const shape = {
    length: value.length,
    startsWith: value.slice(0, 13),
    hasOuterWhitespace: value !== value.trim(),
    hasNewline: /[\r\n]/.test(value),
    hasQuoteOrBracket: /["'<>]/.test(value),
  }
  try {
    const url = new URL(value)
    shape.protocol = url.protocol
    shape.user = url.username
    shape.host = url.hostname
    shape.database = url.pathname
    shape.passwordLength = decodeURIComponent(url.password).length
  } catch {
    shape.parse = 'not a valid URL'
  }
  console.log(`db-url-shape: ${name} ${JSON.stringify(shape)}`)
}
