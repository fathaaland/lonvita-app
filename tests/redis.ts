/** Same Redis as the app, but a DB no worker listens on — see vitest.setup.ts. */
const TEST_REDIS_DB = '15'

const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
url.pathname = `/${TEST_REDIS_DB}`

export const TEST_REDIS_URL = url.toString()
