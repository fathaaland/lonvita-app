import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ImageResponse } from 'next/og'
import sharp from 'sharp'

import { formatPragueEventWhen } from '@/lib/date'
import { eventPriceLabel, SHARE_IMAGE_SIZES, truncateText, type ShareImageFormat } from '@/lib/eventShare'

import { readShareEventImage, type ShareEvent } from './loadShareEvent'

/** The brand palette (globals.css) — Satori takes plain colours, not the CSS variables. */
const COLORS = {
  ivory: '#f9efe7',
  graphite: '#2e2e2e',
  graphiteMid: '#4a4a4a',
  primary: '#b04eb1',
  purplePale: '#f5dbf5',
  sagePale: '#e8f0e6',
  success: '#4f6f44',
  dangerPale: '#fbe3e1',
  danger: '#b3261e',
  white: '#ffffff',
}

const FONT_FAMILY = 'Noto Sans'

type Assets = {
  regular: Buffer
  bold: Buffer
  logo: { src: string; width: number; height: number }
}

let assets: Promise<Assets> | undefined

/** The fonts the PDF exports use (Satori's built-in one has no č/ř/ž) and the Lonvita symbol —
 * read once per process. A failed read isn't kept, so the next request tries again. */
const loadAssets = (): Promise<Assets> => {
  assets ??= (async () => {
    const root = process.cwd()
    const [regular, bold, logoPng] = await Promise.all([
      readFile(path.join(root, 'src/lib/exports/fonts/NotoSans-Regular.ttf')),
      readFile(path.join(root, 'src/lib/exports/fonts/NotoSans-Bold.ttf')),
      readFile(path.join(root, 'src/assets/lonvita-symbol.png')),
    ])
    const { data, info } = await sharp(logoPng).resize({ width: 240 }).png().toBuffer({ resolveWithObject: true })
    return { regular, bold, logo: { src: dataUri(data, 'image/png'), width: info.width, height: info.height } }
  })().catch((error) => {
    assets = undefined
    throw error
  })
  return assets
}

const dataUri = (bytes: Buffer, mimeType: string) => `data:${mimeType};base64,${bytes.toString('base64')}`

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

/** The photo cut to exactly `width`×`height` the way CSS `object-fit: cover` with the organizer's
 * `object-position` shows it on the event card, as a small JPEG — Satori would otherwise embed the
 * full-size original. Null if the bytes aren't an image sharp can read. */
async function coverPhoto(
  bytes: Buffer,
  width: number,
  height: number,
  positionX: number,
  positionY: number,
): Promise<string | null> {
  try {
    const { data, info } = await sharp(bytes)
      .rotate()
      .resize({ width, height, fit: 'outside' })
      .toBuffer({ resolveWithObject: true })
    const cropWidth = Math.min(width, info.width)
    const cropHeight = Math.min(height, info.height)
    const cropped = await sharp(data)
      .extract({
        left: Math.round(((info.width - cropWidth) * clampPercent(positionX)) / 100),
        top: Math.round(((info.height - cropHeight) * clampPercent(positionY)) / 100),
        width: cropWidth,
        height: cropHeight,
      })
      .resize({ width, height, fit: 'fill' })
      .flatten({ background: COLORS.white })
      .jpeg({ quality: 82 })
      .toBuffer()
    return dataUri(cropped, 'image/jpeg')
  } catch {
    return null
  }
}

/** A long title steps down a size or two rather than running over the photo. */
const titleFontSize = (title: string, [short, medium, long]: [number, number, number]) =>
  title.length <= 28 ? short : title.length <= 56 ? medium : long

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function CalendarIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  )
}

function PinIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function Brand({ logo, size }: { logo: Assets['logo']; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
      <img src={logo.src} width={size} height={Math.round((size * logo.height) / logo.width)} />
      <div style={{ display: 'flex', fontSize: size * 0.72, fontWeight: 700, color: COLORS.graphite }}>Lonvita</div>
    </div>
  )
}

/** The photo, or with none the brand symbol on pale purple in its place. */
function Photo({
  src,
  logo,
  width,
  height,
  radius = 0,
}: {
  src: string | null
  logo: Assets['logo']
  width: number
  height: number
  radius?: number
}) {
  if (src) return <img src={src} width={width} height={height} style={{ borderRadius: radius }} />
  const logoSize = Math.round(Math.min(width, height) * 0.4)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width,
        height,
        borderRadius: radius,
        backgroundColor: COLORS.purplePale,
      }}
    >
      <img src={logo.src} width={logoSize} height={Math.round((logoSize * logo.height) / logo.width)} />
    </div>
  )
}

function Pill({ label, color, background, size }: { label: string; color: string; background: string; size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        fontSize: size,
        fontWeight: 700,
        color,
        backgroundColor: background,
        borderRadius: 999,
        padding: `${size * 0.35}px ${size * 0.8}px`,
      }}
    >
      {label}
    </div>
  )
}

/** Title, when, where and who — the part every format shares, at the format's own scale. */
function Details({ event, scale, titleSizes }: { event: ShareEvent; scale: number; titleSizes: [number, number, number] }) {
  const title = truncateText(event.title, 90)
  const iconSize = Math.round(34 * scale)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 * scale }}>
      <div
        style={{
          display: 'flex',
          fontSize: titleFontSize(title, titleSizes),
          fontWeight: 700,
          lineHeight: 1.12,
          color: COLORS.graphite,
          marginBottom: 10 * scale,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 * scale }}>
        <CalendarIcon size={iconSize} color={COLORS.primary} />
        <div style={{ display: 'flex', fontSize: 34 * scale, fontWeight: 700, color: COLORS.primary }}>
          {capitalize(formatPragueEventWhen(event.dateTime, event.endDateTime))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 * scale }}>
        <PinIcon size={iconSize} color={COLORS.graphiteMid} />
        <div style={{ display: 'flex', fontSize: 30 * scale, color: COLORS.graphiteMid }}>
          {truncateText(event.locationText, 70)}
        </div>
      </div>
      {event.organizationName && (
        <div style={{ display: 'flex', fontSize: 26 * scale, color: COLORS.graphiteMid }}>
          {`Pořádá ${truncateText(event.organizationName, 60)}`}
        </div>
      )}
    </div>
  )
}

function Pills({ event, size }: { event: ShareEvent; size: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: size * 0.5 }}>
      {event.status === 'cancelled' ? (
        <Pill label="Akce je zrušena" color={COLORS.danger} background={COLORS.dangerPale} size={size} />
      ) : (
        <Pill label={eventPriceLabel(event)} color={COLORS.success} background={COLORS.sagePale} size={size} />
      )}
      {event.isVolunteering && event.status !== 'cancelled' && (
        <Pill label="Hledáme dobrovolníky" color={COLORS.primary} background={COLORS.purplePale} size={size} />
      )}
    </div>
  )
}

const PHOTO_SIZE: Record<ShareImageFormat, { width: number; height: number; radius: number }> = {
  // The left part of the link preview.
  og: { width: 520, height: 630, radius: 0 },
  // 16:10 — the framing the organizer chose for the event card carries over as it is.
  post: { width: 1080, height: 675, radius: 0 },
  story: { width: 960, height: 600, radius: 40 },
}

function Layout({
  event,
  format,
  photo,
  logo,
  link,
}: {
  event: ShareEvent
  format: ShareImageFormat
  photo: string | null
  logo: Assets['logo']
  link: string
}) {
  const photoSize = PHOTO_SIZE[format]
  const base = { display: 'flex', width: '100%', height: '100%', backgroundColor: COLORS.ivory, fontFamily: FONT_FAMILY } as const

  if (format === 'og') {
    return (
      <div style={base}>
        <Photo src={photo} logo={logo} {...photoSize} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '48px 56px' }}>
          <Brand logo={logo} size={44} />
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
            <Details event={event} scale={0.85} titleSizes={[54, 44, 36]} />
          </div>
          <Pills event={event} size={24} />
        </div>
      </div>
    )
  }

  if (format === 'post') {
    return (
      <div style={{ ...base, flexDirection: 'column' }}>
        <Photo src={photo} logo={logo} {...photoSize} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '52px 72px 60px' }}>
          <Details event={event} scale={1} titleSizes={[72, 58, 48]} />
          <div style={{ display: 'flex', flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
            <Pills event={event} size={28} />
            {/* A link in an Instagram post can't be clicked — the address is there to be typed. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
              <Brand logo={logo} size={52} />
              <div style={{ display: 'flex', fontSize: 26, color: COLORS.graphiteMid }}>{link}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Story: Instagram lays its own header over the top ~250 px and the reply bar over the bottom
  // ~250 px, so nothing that matters goes there. The address under the button is for reading — the
  // clickable way in is the "Odkaz" sticker the dialog has the link copied for.
  return (
    <div style={{ ...base, flexDirection: 'column', alignItems: 'center', padding: '0 60px' }}>
      <div style={{ display: 'flex', height: 270, alignItems: 'flex-end', paddingBottom: 48 }}>
        <Brand logo={logo} size={64} />
      </div>
      <Photo src={photo} logo={logo} {...photoSize} />
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, paddingTop: 64, gap: 40 }}>
        <Details event={event} scale={1.2} titleSizes={[88, 72, 58]} />
        <Pills event={event} size={34} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 420, gap: 20 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 38,
            fontWeight: 700,
            color: COLORS.white,
            backgroundColor: COLORS.primary,
            borderRadius: 999,
            padding: '22px 48px',
          }}
        >
          Přihlaste se v aplikaci Lonvita
        </div>
        <div style={{ display: 'flex', fontSize: 34, color: COLORS.graphiteMid }}>{link}</div>
      </div>
    </div>
  )
}

/** The event's share image in `format` (SHARE_IMAGE_SIZES) as JPEG bytes — a tenth of the PNG that
 * ImageResponse renders once there's a photo in it (~2 MB), on a phone's data and for the crawlers.
 * Rendered to the end here: an ImageResponse only renders as it's streamed out, past any error
 * handling of the caller. `link` is the event's address as printed on the Instagram images
 * (eventDisplayLink). */
export async function renderEventShareImage(event: ShareEvent, format: ShareImageFormat, link: string): Promise<Buffer> {
  const { width, height } = SHARE_IMAGE_SIZES[format]
  const photoSize = PHOTO_SIZE[format]
  const [{ regular, bold, logo }, photoBytes] = await Promise.all([
    loadAssets(),
    event.image ? readShareEventImage(event.image.key) : Promise.resolve(null),
  ])
  const photo =
    photoBytes && event.image
      ? await coverPhoto(photoBytes, photoSize.width, photoSize.height, event.image.positionX, event.image.positionY)
      : null

  const png = await new ImageResponse(<Layout event={event} format={format} photo={photo} logo={logo} link={link} />, {
    width,
    height,
    fonts: [
      { name: FONT_FAMILY, data: regular, weight: 400, style: 'normal' },
      { name: FONT_FAMILY, data: bold, weight: 700, style: 'normal' },
    ],
  }).arrayBuffer()
  return sharp(Buffer.from(png)).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
}
