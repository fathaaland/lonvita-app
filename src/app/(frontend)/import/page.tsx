'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Landmark } from 'lucide-react'

import { getMyOrganizations, type MyOrganizationRow } from '@/integrations/payload/queries'
import { useAuth } from '@/contexts/AuthContext'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { PageHeader } from '@/components/PageHeader'
import { Loading } from '@/components/Loading'
import { ImportPanel } from '@/components/admin/ImportPanel'
import { Card, CardContent } from '@/components/ui/card'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

/**
 * "Import akcí" (docs/import-akci-z-webu.md) — an organizer's own calendars: for each organization
 * they own, the pages its events are read from, the events found and the taken-over ones their web
 * changed. What the obec imports is its admins' business, in its dashboard — an obec admin finds
 * the way there from here.
 */
function ImportContent() {
  const { user, administeredMunicipalityIds } = useAuth()
  const [organizations, setOrganizations] = useState<MyOrganizationRow[] | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    getMyOrganizations(String(user.id), administeredMunicipalityIds)
      .then((rows) => active && setOrganizations(rows))
      .catch(() => active && setOrganizations([]))
    return () => {
      active = false
    }
  }, [user, administeredMunicipalityIds])

  if (!organizations) return <Loading />
  const own = organizations.filter((o) => o.is_own && o.type !== MUNICIPALITY_ORGANIZATION_TYPE)
  const obce = organizations.filter((o) => o.type === MUNICIPALITY_ORGANIZATION_TYPE)

  return (
    <div className="space-y-8">
      {obce.map((obec) => (
        <Card key={obec.id}>
          <CardContent className="p-4">
            <Link
              href="/admin-obce?tab=import"
              className="flex items-center gap-3 font-semibold hover:underline"
            >
              <Landmark className="h-5 w-5 text-primary shrink-0" aria-hidden />
              <span className="flex-1">Import akcí obce {obec.municipality_name}</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      ))}
      {own.map((organization) => (
        <section key={organization.id} className="space-y-3">
          {own.length + obce.length > 1 && (
            <h2 className="text-lg font-bold">{organization.name}</h2>
          )}
          <ImportPanel
            municipalityId={organization.municipality_id}
            organizationId={organization.id}
          />
        </section>
      ))}
      {own.length === 0 && obce.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Import akcí je pro pořadatele — jakmile vám obec schválí roli organizátora, můžete sem
          přidat kalendář svého webu.
        </p>
      )}
    </div>
  )
}

export default function ImportPage() {
  return (
    <RequireAuth>
      <RequireRole role="organizer">
        <div className="animate-fade-in sm:mx-auto sm:max-w-4xl">
          <PageHeader title="Import akcí" />
          <ImportContent />
        </div>
      </RequireRole>
    </RequireAuth>
  )
}
