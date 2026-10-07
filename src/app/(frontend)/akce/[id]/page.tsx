import type { Metadata } from 'next'

import { formatPragueEventWhen } from '@/lib/date'
import { eventPath, eventShareImagePath, SHARE_IMAGE_SIZES, truncateText } from '@/lib/eventShare'
import { loadShareEvent } from '@/lib/share/loadShareEvent'

import { EventDetail } from './EventDetail'

type Props = { params: Promise<{ id: string }> }

/**
 * What a shared link to the event shows — Facebook, Messenger, WhatsApp and the like read these
 * Open Graph tags (title, text, the generated preview image), not the page itself, which renders
 * in the browser.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const event = await loadShareEvent(id)
  if (!event) return { title: 'Akce nebyla nalezena · Lonvita' }

  const title = `${event.title} · Lonvita`
  const when = formatPragueEventWhen(event.dateTime, event.endDateTime)
  const description = truncateText(
    [`${when.charAt(0).toUpperCase()}${when.slice(1)}, ${event.locationText}.`, event.description ?? '']
      .join(' ')
      .replace(/\s+/g, ' '),
    200,
  )
  const image = {
    url: eventShareImagePath(event.id, 'og', event.updatedAt),
    ...SHARE_IMAGE_SIZES.og,
    alt: event.title,
  }

  return {
    title,
    description,
    alternates: { canonical: eventPath(event.id) },
    openGraph: {
      type: 'website',
      locale: 'cs_CZ',
      siteName: 'Lonvita',
      url: eventPath(event.id),
      title: event.title,
      description,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: event.title, description, images: [image] },
  }
}

export default function EventDetailPage() {
  return <EventDetail />
}
