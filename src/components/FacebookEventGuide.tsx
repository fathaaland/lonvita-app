"use client";

import { ArrowLeft, Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyToClipboard, downloadFile } from "@/lib/browserShare";
import { formatPragueEventWhen } from "@/lib/date";
import { FACEBOOK_CREATE_EVENT_URL } from "@/lib/eventShare";
import { cn } from "@/lib/utils";

function Field({
  label,
  value,
  hint,
  copyable = false,
  clamp = false,
}: {
  label: string;
  value: string;
  hint?: string;
  copyable?: boolean;
  /** A long text shows only its start — it's copied whole. */
  clamp?: boolean;
}) {
  const copy = async () => {
    if (await copyToClipboard(value)) toast.success(`${label}: zkopírováno.`);
    else toast.error("Nepodařilo se zkopírovat — označte text a zkopírujte ho ručně.");
  };

  return (
    <div className="rounded-lg border border-border p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {copyable && (
          <Button variant="ghost" size="sm" className="h-9 -my-1" onClick={copy} aria-label={`Kopírovat: ${label}`}>
            <Copy aria-hidden />
            Kopírovat
          </Button>
        )}
      </div>
      <p className={cn("text-sm whitespace-pre-line break-words", clamp && "line-clamp-4")}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * "Vytvořit událost na Facebooku" — Meta lets no app create a Facebook event, and its form takes
 * nothing prefilled, so the organizer creates it by hand: we open the form, hand over the cover image
 * and every field ready to copy.
 */
export function FacebookEventGuide({
  title,
  dateTime,
  endDateTime,
  locationText,
  description,
  cover,
  onPhone,
  onBack,
}: {
  title: string;
  dateTime: string;
  endDateTime?: string | null;
  locationText: string;
  /** buildFacebookEventDescription — the event's text with the price and the sign-up link. */
  description: string;
  /** The link-preview image, 1.91:1 like Facebook's event cover; null while it's still loading. */
  cover: File | null;
  /** On a phone the link opens Facebook's app only if it's installed and lets it (iOS, from a tap). */
  onPhone: boolean;
  onBack: () => void;
}) {
  const when = formatPragueEventWhen(dateTime, endDateTime);

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        <li className="space-y-2">
          <p className="text-sm font-semibold">1. Otevřete na Facebooku novou událost</p>
          <Button asChild variant="outline" className="h-12 w-full justify-start">
            <a href={FACEBOOK_CREATE_EVENT_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="text-[#1877F2]" aria-hidden />
              Otevřít Facebook – nová událost
            </a>
          </Button>
          {onPhone && (
            <p className="text-xs text-muted-foreground">
              Když se místo aplikace otevře jen web, založte událost přímo v aplikaci Facebook: v nabídce Události →
              Vytvořit. Údaje níže si zkopírujete stejně.
            </p>
          )}
        </li>
        <li className="space-y-2">
          <p className="text-sm font-semibold">2. Nahrajte titulní fotku</p>
          <Button
            variant="outline"
            className="h-12 w-full justify-start"
            disabled={!cover}
            onClick={() => {
              if (!cover) return;
              downloadFile(cover);
              toast.success("Titulní obrázek je stažený — na Facebooku ho nahrajte jako fotku události.");
            }}
          >
            {cover ? <Download aria-hidden /> : <Loader2 className="animate-spin" aria-hidden />}
            Stáhnout titulní obrázek
          </Button>
        </li>
        <li className="space-y-2">
          <p className="text-sm font-semibold">3. Vyplňte údaje</p>
          <Field label="Název události" value={title} copyable />
          <Field
            label="Datum a čas"
            value={`${when.charAt(0).toUpperCase()}${when.slice(1)}`}
            hint="Na Facebooku je nastavte v kalendáři formuláře."
          />
          <Field label="Místo" value={locationText} copyable />
          <Field label="Popis" value={description} copyable clamp />
        </li>
      </ol>
      <Button variant="ghost" className="h-11" onClick={onBack}>
        <ArrowLeft aria-hidden />
        Zpět na sdílení
      </Button>
    </div>
  );
}
