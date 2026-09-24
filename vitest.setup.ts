// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

import { TEST_REDIS_URL } from './tests/redis'

// Hooks under test enqueue real jobs (e-mails, reminders). On the shared Redis DB the local
// worker would pick them up and try to mail the @test.local users — keep them on their own DB.
process.env.REDIS_URL = TEST_REDIS_URL
