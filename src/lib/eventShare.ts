/**
 * Sharing an event on social networks. Neither Facebook nor Instagram lets a web page hand them a
 * finished post: Facebook shares a link and builds its preview from the page's Open Graph tags
 * (Meta's policy forbids prefilling the post's text), and Instagram doesn't take links from the web
 * at all — only an image, through the phone's share sheet. So "a post" here is a generated image
 * (the link preview, an Instagram post, a story) plus a suggested text copied to the clipboard.
 */

import { formatPragueEventWhen } from "@/lib/date";
import { hasEventEnded } from "@/lib/eventEnded";
import { formatCzk } from "@/lib/money";

/** The link preview (Facebook, Messenger, WhatsApp — 1.91:1), an Instagram feed post (4:5, the
 * tallest it shows uncropped) and a story (9:16, Instagram and Facebook alike). */
export const SHARE_IMAGE_SIZES = {
  og: { width: 1200, height: 630 },
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;

export type ShareImageFormat = keyof typeof SHARE_IMAGE_SIZES;

export const isShareImageFormat = (value: unknown): value is ShareImageFormat =>
  typeof value === "string" && Object.hasOwn(SHARE_IMAGE_SIZES, value);

/** What the share text and images are made of — the same on the server and in the browser. */
export type EventShareInfo = {
  title: string;
  description?: string | null;
  dateTime: string;
  endDateTime?: string | null;
  locationText: string;
  isPaid?: boolean | null;
  priceCents?: number | null;
  isVolunteering?: boolean | null;
};

/** Only an upcoming event that's out in public is worth inviting people to — not a cancelled one,
 * one the organizer took down for now (isHidden), or one that has already taken place. */
export function isEventShareable(event: {
  status?: string | null;
  isHidden?: boolean | null;
  dateTime: string;
  endDateTime?: string | null;
}): boolean {
  if (event.isHidden) return false;
  if (event.status !== "active" && event.status !== "full") return false;
  return !hasEventEnded(event.dateTime, event.endDateTime);
}

export const eventPath = (id: string | number): string => `/akce/${id}`;

/** "lonvita.cz/akce/12" — the event's address to print on an image, short enough to type. */
export const eventDisplayLink = (origin: string, id: string | number): string =>
  `${new URL(origin).host.replace(/^www\./, "")}${eventPath(id)}`;

/** Changes whenever the event does (a new photo or framing included, both live on the event), so
 * a versioned image URL can be cached for good — and Facebook, which caches previews by image URL,
 * picks up an edited event instead of showing the old picture. */
export const shareImageVersion = (updatedAt: string): string => String(Date.parse(updatedAt));

export function eventShareImagePath(id: string | number, format: ShareImageFormat, updatedAt?: string | null): string {
  const params = new URLSearchParams({ format });
  if (updatedAt) params.set("v", shareImageVersion(updatedAt));
  return `/api/events/${id}/share-image?${params}`;
}

export const facebookShareUrl = (url: string): string =>
  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;

export function eventPriceLabel(event: Pick<EventShareInfo, "isPaid" | "priceCents">): string {
  if (!event.isPaid) return "Vstup zdarma";
  return event.priceCents ? `Vstupné ${formatCzk(event.priceCents)}` : "Placená akce";
}

/** `text` cut to at most `max` characters, at a word boundary where there's one close by. */
export function truncateText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The suggested text of the post, for the person to paste (and edit) on Facebook or Instagram. */
export function buildEventShareCaption(event: EventShareInfo, url: string): string {
  const lines = [
    event.title.trim(),
    "",
    `📅 ${formatPragueEventWhen(event.dateTime, event.endDateTime)}`,
    `📍 ${event.locationText.trim()}`,
    `🎟️ ${eventPriceLabel(event)}`,
  ];
  if (event.isVolunteering) lines.push("🙋 Hledáme i dobrovolníky");
  const description = event.description?.trim();
  if (description) lines.push("", truncateText(description, 400));
  lines.push("", `Přihlaste se: ${url}`, "", "#Lonvita");
  return lines.join("\n");
}

/** Facebook's own form for a new event. Meta lets no app create events (the Graph API dropped it in
 * v2.0), and the form takes nothing prefilled — the organizer fills it in from what we prepare. */
export const FACEBOOK_CREATE_EVENT_URL = "https://www.facebook.com/events/create/";

/** The description for that Facebook event: the event's own text, what it costs and where to sign up
 * (date, time and place have fields of their own there). */
export function buildFacebookEventDescription(event: EventShareInfo, url: string): string {
  const lines: string[] = [];
  const description = event.description?.trim();
  if (description) lines.push(description, "");
  lines.push(`🎟️ ${eventPriceLabel(event)}`);
  if (event.isVolunteering) lines.push("🙋 Hledáme i dobrovolníky");
  lines.push("", `Přihlaste se v aplikaci Lonvita: ${url}`);
  return lines.join("\n");
}

/** "lonvita-letni-kino-na-navsi-prispevek.jpg" */
export function shareImageFileName(title: string, format: ShareImageFormat): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  const suffix = { og: "nahled", post: "prispevek", story: "pribeh" }[format];
  return `lonvita-${slug || "akce"}-${suffix}.jpg`;
}
