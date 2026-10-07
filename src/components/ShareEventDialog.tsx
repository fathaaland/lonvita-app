"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarPlus, Copy, Facebook, ImageIcon, Instagram, Link2, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { FacebookEventGuide } from "@/components/FacebookEventGuide";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EventRow } from "@/integrations/payload/queries";
import { copyToClipboard, downloadFile } from "@/lib/browserShare";
import {
  buildEventShareCaption,
  buildFacebookEventDescription,
  eventPath,
  eventShareImagePath,
  facebookShareUrl,
  shareImageFileName,
  type EventShareInfo,
  type ShareImageFormat,
} from "@/lib/eventShare";

type ShareableEvent = Pick<
  EventRow,
  | "id"
  | "title"
  | "description"
  | "date_time"
  | "end_date_time"
  | "location_text"
  | "is_paid"
  | "price_cents"
  | "is_volunteering"
  | "updated_at"
>;

type Network = "Facebook" | "Instagram";

/** Where the image goes and where its text — the two networks take different Czech prepositions. */
const NETWORK_COPY: Record<Network, { uploadTo: string; pasteAs: string }> = {
  Facebook: { uploadTo: "na Facebook", pasteAs: "do příspěvku" },
  Instagram: { uploadTo: "do Instagramu", pasteAs: "jako popisek" },
};

const IMAGE_FORMATS: ShareImageFormat[] = ["og", "post", "story"];

const PASTE_IT_YOURSELF = "Text příspěvku zkopírujte z pole níže a vložte ho do příspěvku.";

const toShareInfo = (event: ShareableEvent): EventShareInfo => ({
  title: event.title,
  description: event.description,
  dateTime: event.date_time,
  endDateTime: event.end_date_time,
  locationText: event.location_text,
  isPaid: event.is_paid,
  priceCents: event.price_cents,
  isVolunteering: event.is_volunteering,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

/**
 * "Sdílet akci". Facebook: a link (its preview, image included, comes from the event detail's Open
 * Graph tags), the generated image as a photo post, or a hand-made Facebook event (FacebookEventGuide).
 * Instagram: the generated image (it takes no links from the web). Images go through the phone's share
 * sheet, or on a computer get downloaded. Neither network lets a page prefill the post's text, so the
 * suggested text goes to the clipboard to paste.
 */
export function ShareEventDialog({
  open,
  onOpenChange,
  event,
  justCreated = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ShareableEvent;
  /** Opened straight after the organizer created the event. */
  justCreated?: boolean;
}) {
  const [view, setView] = useState<"share" | "facebook-event">("share");
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<Partial<Record<ShareImageFormat, File>>>({});
  const [filesFailed, setFilesFailed] = useState(false);
  // Only a phone's share sheet offers Facebook and Instagram — on a computer the image is downloaded.
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [canShareLink, setCanShareLink] = useState(false);
  // Facebook's and Instagram's own browser, where a shared link opens: it has no share sheet and
  // takes no downloads — images can only go out from a real browser.
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    if (!open) return;
    const eventUrl = `${window.location.origin}${eventPath(event.id)}`;
    setView("share");
    setUrl(eventUrl);
    setCaption(buildEventShareCaption(toShareInfo(event), eventUrl));
    setCanShareLink(typeof navigator.share === "function");
    setInAppBrowser(/FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent));
  }, [open, event]);

  // Fetched as the dialog opens, not on the click: iOS lets navigator.share() through only straight
  // from the tap, with no download waited on in between.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setFiles({});
    setFilesFailed(false);
    Promise.all(
      IMAGE_FORMATS.map(async (format) => {
        const response = await fetch(eventShareImagePath(event.id, format, event.updated_at));
        if (!response.ok) throw new Error(`share image ${response.status}`);
        const blob = await response.blob();
        return [format, new File([blob], shareImageFileName(event.title, format), { type: "image/jpeg" })] as const;
      }),
    )
      .then((entries) => {
        if (!active) return;
        const loaded = Object.fromEntries(entries) as Record<ShareImageFormat, File>;
        setFiles(loaded);
        setCanShareFiles(
          window.matchMedia("(pointer: coarse)").matches &&
            typeof navigator.canShare === "function" &&
            navigator.canShare({ files: [loaded.post] }),
        );
      })
      .catch(() => {
        if (active) setFilesFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, event.id, event.updated_at, event.title]);

  const copyCaption = async () => {
    if (await copyToClipboard(caption)) toast.success("Text příspěvku je zkopírovaný.");
    else toast.error("Text se nepodařilo zkopírovat — označte ho a zkopírujte ručně.");
  };

  const copyLink = async () => {
    if (await copyToClipboard(url)) toast.success("Odkaz na akci je zkopírovaný.");
    else toast.error("Odkaz se nepodařilo zkopírovat.");
  };

  const shareLinkOnFacebook = async () => {
    // Copied before the window opens — a document that has lost focus to it may not write to the
    // clipboard any more.
    const copied = await copyToClipboard(caption);
    const popup = window.open(facebookShareUrl(url), "facebook-share", "width=626,height=640");
    if (popup) popup.opener = null;
    if (copied) toast.success("Text příspěvku je zkopírovaný — na Facebooku ho vložte do příspěvku.");
    else toast.info(PASTE_IT_YOURSELF);
  };

  const shareImage = (format: ShareImageFormat, network: Network) => {
    const file = files[format];
    if (!file) return;
    const { uploadTo, pasteAs } = NETWORK_COPY[network];
    // A story has no caption — the way in is Instagram's "Odkaz" sticker, so it gets the link.
    const story = format === "story";
    // Both started right here, in the tap itself, with nothing awaited before them: Safari lets
    // navigator.share() through only straight from the tap, and the clipboard write has to begin
    // while the page still has focus — the share sheet takes it.
    const copying = copyToClipboard(story ? url : caption);

    if (!canShareFiles) {
      downloadFile(file);
      void copying.then((copied) =>
        toast.success(
          story
            ? copied
              ? "Obrázek je stažený a odkaz zkopírovaný. Nahrajte ho do příběhu a přidejte nálepku „Odkaz“ s odkazem na akci."
              : `Obrázek je stažený. Nahrajte ho do příběhu a přidejte nálepku „Odkaz“ s adresou ${url}.`
            : copied
              ? `Obrázek je stažený a text zkopírovaný. Nahrajte obrázek ${uploadTo} a text vložte ${pasteAs}.`
              : `Obrázek je stažený. Nahrajte ho ${uploadTo} a text příspěvku zkopírujte z pole níže.`,
        ),
      );
      return;
    }

    navigator
      .share({ files: [file] })
      .then(async () => {
        const copied = await copying;
        if (story) {
          if (copied) toast.success("Odkaz na akci je zkopírovaný — v příběhu přidejte nálepku „Odkaz“ a vložte ho.");
          else toast.info(`V příběhu přidejte nálepku „Odkaz“ s adresou ${url}.`);
        } else if (copied) {
          toast.success(`Text příspěvku je zkopírovaný — vložte ho ${pasteAs}.`);
        } else {
          toast.info(PASTE_IT_YOURSELF);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // An image the app can't take (reported for Instagram's feed on iOS): fall back to the file.
        downloadFile(file);
        toast.info(`Sdílení se nepodařilo, obrázek jsme stáhli. Nahrajte ho ${uploadTo} ručně.`);
      });
  };

  const shareElsewhere = async () => {
    try {
      await navigator.share({ title: event.title, url });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error("Sdílení se nepodařilo.");
      }
    }
  };

  const imagesReady = Boolean(files.post && files.story);
  const imageIcon = (icon: ReactNode) => (imagesReady ? icon : <Loader2 className="animate-spin" aria-hidden />);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {view === "facebook-event" ? (
          <>
            <DialogHeader>
              <DialogTitle>Událost na Facebooku</DialogTitle>
              <DialogDescription>
                Facebook nedovoluje aplikacím zakládat události za vás. Všechno potřebné jsme připravili — stačí to
                zkopírovat do jeho formuláře.
              </DialogDescription>
            </DialogHeader>
            <FacebookEventGuide
              title={event.title}
              dateTime={event.date_time}
              endDateTime={event.end_date_time}
              locationText={event.location_text}
              description={buildFacebookEventDescription(toShareInfo(event), url)}
              cover={files.og ?? null}
              onBack={() => setView("share")}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{justCreated ? "Akce je vytvořená — pozvěte lidi" : "Sdílet akci"}</DialogTitle>
              <DialogDescription>
                Facebook ukáže náhled akce s obrázkem. Text příspěvku vám zkopírujeme, stačí ho vložit.
              </DialogDescription>
            </DialogHeader>

            <img
              src={eventShareImagePath(event.id, "og", event.updated_at)}
              alt={`Náhled akce ${event.title}`}
              width={1200}
              height={630}
              className="w-full h-auto rounded-lg border border-border bg-muted"
            />

            <Section title="Facebook">
              <Button variant="outline" className="h-12 justify-start" onClick={shareLinkOnFacebook}>
                <Facebook className="text-[#1877F2]" aria-hidden />
                Odkaz s náhledem
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-start"
                disabled={!imagesReady}
                onClick={() => shareImage("post", "Facebook")}
              >
                {imageIcon(<ImageIcon className="text-[#1877F2]" aria-hidden />)}
                Příspěvek s obrázkem
              </Button>
              <Button variant="outline" className="h-12 justify-start sm:col-span-2" onClick={() => setView("facebook-event")}>
                <CalendarPlus className="text-[#1877F2]" aria-hidden />
                Vytvořit událost na Facebooku
              </Button>
            </Section>

            <Section title="Instagram">
              <Button
                variant="outline"
                className="h-12 justify-start"
                disabled={!imagesReady}
                onClick={() => shareImage("post", "Instagram")}
              >
                {imageIcon(<Instagram className="text-[#E4405F]" aria-hidden />)}
                Příspěvek
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-start"
                disabled={!imagesReady}
                onClick={() => shareImage("story", "Instagram")}
              >
                {imageIcon(<Instagram className="text-[#E4405F]" aria-hidden />)}
                Příběh
              </Button>
            </Section>

            <Section title="Ostatní">
              <Button variant="outline" className="h-12 justify-start" onClick={copyLink}>
                <Link2 aria-hidden />
                Kopírovat odkaz
              </Button>
              {canShareLink && (
                <Button variant="outline" className="h-12 justify-start" onClick={shareElsewhere}>
                  <Share2 aria-hidden />
                  WhatsApp, Messenger…
                </Button>
              )}
            </Section>

            <p className="text-xs text-muted-foreground">
              {filesFailed
                ? "Obrázky se nepodařilo připravit. Zkuste dialog otevřít znovu."
                : inAppBrowser && !canShareFiles
                  ? "Jste v prohlížeči uvnitř Facebooku nebo Instagramu — obrázky odsud sdílet nejdou. Otevřete stránku v Safari nebo Chrome (menu ⋯ → Otevřít v prohlížeči)."
                  : canShareFiles
                    ? "U obrázků se otevře nabídka sdílení — vyberte v ní Facebook nebo Instagram. Když tam chybí, zvolte „Uložit obrázek“ a nahrajte ho z galerie."
                    : "Obrázky se na počítači stáhnou — nahrajte je na Facebook nebo do Instagramu."}
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="share-caption">Text příspěvku</Label>
                <Button variant="ghost" size="sm" onClick={copyCaption}>
                  <Copy aria-hidden />
                  Kopírovat text
                </Button>
              </div>
              <Textarea
                id="share-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={8}
                className="text-sm"
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
