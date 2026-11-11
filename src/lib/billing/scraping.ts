import type { Payload, PayloadRequest } from 'payload'

import { getBillingCatalog, isPackageKey, type BillingCatalog, type PackageKey } from './catalog'

/**
 * The obec's scraping add-on (Balíčky služeb: "Doplněk scraping") — whether it has it, how many
 * sources its package allows, and the technical cap on one run's input tokens (never billed). The
 * superadmin can set either limit for the obec alone.
 */
export type ScrapingLimits = {
  enabled: boolean
  suspended: boolean
  package: PackageKey
  maxSources: number
  maxInputTokensPerRun: number
}

export async function scrapingLimitsOf(
  payload: Payload,
  municipalityId: number,
  { catalog, req }: { catalog?: BillingCatalog; req?: PayloadRequest } = {},
): Promise<ScrapingLimits> {
  const [m, c] = await Promise.all([
    payload.findByID({
      collection: 'municipalities',
      id: municipalityId,
      depth: 0,
      overrideAccess: true,
      req,
      select: {
        importAiEnabled: true,
        billingStatus: true,
        scrapingPackage: true,
        scrapingMaxSourcesOverride: true,
        scrapingMaxInputTokensOverride: true,
      },
    }),
    catalog ?? getBillingCatalog(payload, req),
  ])
  const pkg = isPackageKey(m.scrapingPackage) ? m.scrapingPackage : 's'
  return {
    enabled: m.importAiEnabled === true,
    suspended: m.billingStatus === 'suspended',
    package: pkg,
    maxSources: m.scrapingMaxSourcesOverride ?? c.scrapingPackages[pkg].maxSources,
    maxInputTokensPerRun: m.scrapingMaxInputTokensOverride ?? c.maxInputTokensPerRun,
  }
}

/** Why the obec may not have one more source switched on — or null when it may. */
export function sourceRefusal(limits: ScrapingLimits, enabledSources: number): string | null {
  if (limits.suspended)
    return 'Služby obce jsou pozastavené — zdroje akcí teď přidávat ani zapínat nejde.'
  if (!limits.enabled)
    return 'Obec nemá objednaný import akcí z webu. Zapne ho na požádání provozovatel Lonvity.'
  if (enabledSources >= limits.maxSources)
    return `Balíček obce dovoluje nejvýš ${limits.maxSources} zapnutých zdrojů akcí. Některý vypněte, nebo si řekněte o větší balíček.`
  return null
}

/**
 * The obec's switched-on sources its package covers — the oldest first, as many as it allows. After a
 * smaller package (or a suspension) more may still be switched on; the rest stay as they are but are
 * not read until the obec switches some off or gets a bigger package. Without scraping, or suspended,
 * none. What the worker reads is decided here, whatever the switches say.
 */
export async function sourcesWithinPackage(
  payload: Payload,
  municipalityId: number,
  { limits, req }: { limits?: ScrapingLimits; req?: PayloadRequest } = {},
): Promise<Set<number>> {
  const l = limits ?? (await scrapingLimitsOf(payload, municipalityId, { req }))
  if (!l.enabled || l.suspended || l.maxSources <= 0) return new Set()
  const sources = await payload.find({
    collection: 'event-sources',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { organization: { exists: false } },
        { enabled: { equals: true } },
      ],
    },
    select: {},
    sort: 'id',
    limit: l.maxSources,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return new Set(sources.docs.map((s) => s.id))
}
