import config from '@payload-config'
import { getPayload } from 'payload'

import type { Payload } from 'payload'

let payloadPromise: Promise<Payload> | null = null

/**
 * The worker's own Payload instance, built once and shared by every job that needs the database.
 * That's most of them by now — the nightly cleanups, feedback prompts, report exports, event
 * update/cancel fan-out, password reset and the status sync — which is why docker-compose has to
 * point it at the `postgres` service and why its start script sets PAYLOAD_MIGRATING (see
 * payload.config's onInit: without it, every worker boot would re-run the seed).
 */
export const getWorkerPayload = (): Promise<Payload> => {
  payloadPromise ??= getPayload({ config })
  return payloadPromise
}
