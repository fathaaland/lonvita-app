'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import {
  approveImportCandidate,
  getImportCandidate,
  type ImportCandidateRow,
} from '@/integrations/payload/import-queries'
import { getMunicipality } from '@/integrations/payload/queries'
import { PayloadApiError } from '@/integrations/payload/client'
import { useAuth } from '@/contexts/AuthContext'
import { RequireAuth, RequireRole } from '@/components/RequireAuth'
import { PageHeader } from '@/components/PageHeader'
import { Loading } from '@/components/Loading'
import { EmptyState } from '@/components/EmptyState'
import { EventForm, type EventFormPrefill, type EventFormValues } from '@/components/EventForm'
import { IMPORT_WARNINGS } from '@/lib/import/contracts'
import { UNLIMITED_CAPACITY } from '@/lib/capacity'
import { toDateInputValue } from '@/lib/date'
import { sendFollowUpRequests } from '@/lib/eventFollowUpRequests'

const toLocalTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })

/** The imported event as the form's starting values — an end on the same day goes into the
 * description, since the form keeps an end only for an event over several days. */
function prefillOf(candidate: ImportCandidateRow): EventFormPrefill {
  const startDate = toDateInputValue(candidate.starts_at)
  const endDate = candidate.ends_at ? toDateInputValue(candidate.ends_at) : ''
  const multiDay = Boolean(endDate) && endDate > startDate
  const sameDayEnd =
    candidate.ends_at && !multiDay ? `\n\nKonec akce v ${toLocalTime(candidate.ends_at)}.` : ''
  return {
    title: candidate.title,
    description: `${candidate.description ?? ''}${sameDayEnd}`.trim(),
    date: startDate,
    time: candidate.time_known ? toLocalTime(candidate.starts_at) : '',
    endDate: multiDay ? endDate : '',
    endTime: multiDay && candidate.ends_at ? toLocalTime(candidate.ends_at) : '',
    location:
      candidate.lat != null && candidate.lng != null && candidate.location_text
        ? { lat: candidate.lat, lng: candidate.lng, label: candidate.location_text }
        : null,
    categoryIds: candidate.category_ids,
    capacity: UNLIMITED_CAPACITY,
    registrationApprovalMode: 'auto',
    isPaid: candidate.is_paid,
    priceCzk: candidate.price_czk,
  }
}

function ImportApprovalContent({ id }: { id: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const [candidate, setCandidate] = useState<ImportCandidateRow | null | undefined>(undefined)
  const [center, setCenter] = useState<[number, number] | null>(null)

  useEffect(() => {
    let active = true
    getImportCandidate(id)
      .then(async (found) => {
        if (!active) return
        setCandidate(found)
        const muni = found ? await getMunicipality(found.municipality_id) : null
        if (active && muni) setCenter([muni.lat, muni.lng])
      })
      .catch(() => active && setCandidate(null))
    return () => {
      active = false
    }
  }, [id])

  const handleSubmit = async (values: EventFormValues) => {
    try {
      const { eventId } = await approveImportCandidate(id, {
        title: values.title,
        description: values.description,
        dateTime: values.dateTimeIso,
        endDateTime: values.endDateTimeIso,
        locationText: values.location.label,
        lat: values.location.lat,
        lng: values.location.lng,
        categoryIds: values.categoryIds.map(Number),
        capacity: values.capacity,
        registrationApprovalMode: values.registrationApprovalMode,
        accessibilityTags: values.accessibilityTags,
        imageId: values.imageId ? Number(values.imageId) : null,
        imagePositionX: values.imagePosition.x,
        imagePositionY: values.imagePosition.y,
        isVolunteering: values.isVolunteering,
        isPaid: values.isPaid,
        priceCents: values.priceCents,
      })
      const sent = await sendFollowUpRequests(eventId, values.inviteOrganizationIds)
      toast.success(sent ? `Akce převzata, ${sent}.` : 'Akce převzata!')
      router.push(`/akce/${eventId}?sdilet=1`)
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status < 500
          ? error.message
          : 'Akci se nepodařilo převzít.',
      )
    }
  }

  if (candidate === undefined || (candidate && !center))
    return (
      <>
        <PageHeader title="Převzít akci" back />
        <Loading />
      </>
    )
  if (!candidate || !user) {
    return (
      <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
        <PageHeader title="Převzít akci" back />
        <EmptyState
          title="Akce k převzetí nenalezena"
          description="Možná o ní už bylo rozhodnuto."
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in sm:mx-auto sm:max-w-3xl">
      <PageHeader title="Převzít akci" back />
      <div className="px-4 pt-4 space-y-1 text-sm text-muted-foreground">
        <p>
          Převzatá z{' '}
          {candidate.detail_url ? (
            <a
              href={candidate.detail_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="underline"
            >
              {new URL(candidate.detail_url).hostname.replace(/^www\./, '')}
            </a>
          ) : candidate.origin === 'text' ? (
            'vloženého textu'
          ) : (
            (candidate.origin_label ?? 'webu obce')
          )}
          . Zkontrolujte údaje a doplňte, co chybí — akce se založí za obec.
        </p>
        {candidate.warnings.map((w) => (
          <p key={w} className="text-amber-700 dark:text-amber-400">
            {IMPORT_WARNINGS[w] ?? w}
          </p>
        ))}
      </div>
      <EventForm
        userId={String(user.id)}
        prefill={prefillOf(candidate)}
        municipalityId={candidate.municipality_id}
        municipalityCenter={center!}
        isObecAdmin
        volunteering="set"
        runsAsObec
        submitLabel="Převzít akci"
        onSubmit={handleSubmit}
      />
    </div>
  )
}

export default function ImportApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <RequireAuth>
      {/* An obec's admin — the event is taken over as the obec (lib/import/approve). */}
      <RequireRole role="municipality_admin">
        <ImportApprovalContent id={id} />
      </RequireRole>
    </RequireAuth>
  )
}
