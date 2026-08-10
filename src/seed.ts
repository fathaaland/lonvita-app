import 'dotenv/config'

import { getPayload } from 'payload'

import config from './payload.config'
import { runSeed } from './lib/seed/run'

const run = async () => {
  const payload = await getPayload({ config })
  await runSeed(payload)
  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
