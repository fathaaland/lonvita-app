"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarPlus, Copy, Facebook, ImageIcon, Instagram, Link2, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { FacebookEventGuide } from "@/components/FacebookEventGuide";
import { MobileShareSteps } from "@/components/MobileShareSteps";
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
import { reportClientError } from "@/lib/logger/client";

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

type Target = "facebook-link" | "facebook-image" | "instagram-post" | "instagram-story";

type App = "Facebook" | "Instagram";

const SITE_URL: Record<App, string> = {
  Facebook: "https://www.facebook.com/",
  Instagram: "https://www.instagram.com/",
};

const saveImageHint = (app: App) =>
  `Když ${app} v nabídce chybí, zvolte „Uložit obrázek“ a v aplikaci ${app} ho nahrajte z galerie.`;

/** What each way of sharing hands over: the generated image (or, for the link, none), the text that
 * goes with it — the caption, or for a story, which has none, the link for Instagram's "Odkaz"
 * sticker — and what to do in the app. */
const TARGETS: Record<Target, { title: string; app: App; format: ShareImageFormat | null; copies: "caption" | "link"; hints: string[] }> = {
  "facebook-link": {
    title: "Facebook – odkaz s náhledem",
    app: "Facebook",
    format: null,
    copies: "caption",
    hints: [
      "V nabídce vyberte Facebook — příspěvek ukáže náhled akce s obrázkem.",
      "Zkopírovaný text vložte nad náhled.",
    ],
  },
  "facebook-image": {
    title: "Facebook – příspěvek s obrázkem",
    app: "Facebook",
    format: "post",
    copies: "caption",
    hints: ["V nabídce vyberte Facebook a zkopírovaný text vložte do příspěvku.", saveImageHint("Facebook")],
  },
  "instagram-post": {
    title: "Instagram – příspěvek",
    app: "Instagram",
    format: "post",
    copies: "caption",
    hints: ["V nabídce vyberte Instagram a zkopírovaný text vložte jako popisek.", saveImageHint("Instagram")],
  },
  "instagram-story": {
    title: "Instagram – příběh",
    app: "Instagram",
    format: "story",
    copies: "link",
    hints: [
      "V nabídce vyberte Instagram a zvolte příběh.",
      "V příběhu přidejte nálepku „Odkaz“ a vložte do ní zkopírovaný odkaz — jen tak jde na akci kliknout.",
      "Když Instagram v nabídce chybí nebo příběh nenabídne, zvolte „Uložit obrázek“ a přidejte ho do příběhu z galerie.",
    ],
  },
};

type View = { name: "share" } | { name: "facebook-event" } | { name: "phone"; target: Target };

const IMAGE_FORMATS: ShareImageFormat[] = ["og", "post", "story"];

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

const describeError = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

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
 * Instagram: the generated image (it takes no links from the web). Neither network lets a page
 * prefill the post's text, so the suggested text goes to the clipboard to paste.
 *
 * On a phone the apps are reached through the share sheet, two taps per share (MobileShareSteps). On
 * a computer the image is downloaded and the network's website opened.
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
  const [view, setView] = useState<View>({ name: "share" });
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<Partial<Record<ShareImageFormat, File>>>({});
  const [filesFailed, setFilesFailed] = useState(false);
  // A phone (or tablet) — its share sheet is the way into the Facebook and Instagram apps.
  const [touch, setTouch] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [canShareLink, setCanShareLink] = useState(false);
  // Facebook's and Instagram's own browser, where a shared link opens: it has no share sheet and
  // takes no downloads — images can only go out from a real browser.
  const [inAppBrowser, setInAppBrowser] = useState(false);

  useEffect(() => {
    if (!open) return;
    const eventUrl = `${window.location.origin}${eventPath(event.id)}`;
    setView({ name: "share" });
    setUrl(eventUrl);
    setCaption(buildEventShareCaption(toShareInfo(event), eventUrl));
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    setCanShareLink(typeof navigator.share === "function");
    setInAppBrowser(/FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent));
  }, [open, event]);

  // Fetched as the dialog opens, not on the tap: iOS lets navigator.share() through only straight
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
        const onTouch = window.matchMedia("(pointer: coarse)").matches;
        const filesShareable = typeof navigator.canShare === "function" && navigator.canShare({ files: [loaded.post] });
        setFiles(loaded);
        setCanShareFiles(onTouch && filesShareable);
        // A phone that can't hand images to the apps gets downloads instead — worth knowing which.
        if (onTouch && !filesShareable) {
          reportClientError({
            event: "share_files_unsupported",
            level: "warn",
            message: `share=${typeof navigator.share} canShare=${typeof navigator.canShare} inApp=${/FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent)}`,
          });
        }
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

  const choose = (target: Target) => {
    const { format } = TARGETS[target];
    const viaShareSheet = format ? canShareFiles : touch && canShareLink;
    if (viaShareSheet) setView({ name: "phone", target });
    else if (format) void shareImageFromComputer(target);
    else void shareLinkFromComputer();
  };

  /** Facebook's own share window — on a computer. On a phone it would open Facebook's website, not
   * the app (iOS hands a link to the app only when it's tapped, never from window.open). */
  const shareLinkFromComputer = async () => {
    // Copied before the window opens — a document that has lost focus to it may not write to the
    // clipboard any more.
    const copied = await copyToClipboard(caption);
    const popup = window.open(facebookShareUrl(url), "facebook-share", "width=626,height=640");
    if (popup) popup.opener = null;
    if (copied) toast.success("Text příspěvku je zkopírovaný — na Facebooku ho vložte do příspěvku.");
    else toast.info("Text příspěvku zkopírujte z pole níže a vložte ho do příspěvku.");
  };

  const shareImageFromComputer = async (target: Target) => {
    const { app, format, copies } = TARGETS[target];
    const file = format ? files[format] : undefined;
    if (!file) return;
    const copied = await copyToClipboard(copies === "link" ? url : caption);
    downloadFile(file);

    if (target === "instagram-story") {
      toast.info(
        copied
          ? "Obrázek je stažený a odkaz zkopírovaný. Příběh jde přidat jen v aplikaci Instagram v telefonu — pošlete si obrázek do telefonu a přidejte nálepku „Odkaz“."
          : "Obrázek je stažený. Příběh jde přidat jen v aplikaci Instagram v telefonu — pošlete si obrázek do telefonu.",
        { duration: 10_000 },
      );
      return;
    }

    window.open(SITE_URL[app], "_blank", "noopener,noreferrer");
    toast.success(
      copied
        ? `Obrázek je stažený a text zkopírovaný. Na ${app}u vytvořte příspěvek, nahrajte obrázek a vložte text.`
        : `Obrázek je stažený. Na ${app}u vytvořte příspěvek a nahrajte ho, text zkopírujte z pole níže.`,
      { duration: 10_000 },
    );
  };

  /** Step 2 of MobileShareSteps — straight from its tap, and nothing else in it. */
  const shareFromPhone = (target: Target) => {
    const { app, format } = TARGETS[target];
    const file = format ? files[format] : undefined;
    if (format && !file) return;
    navigator.share(file ? { files: [file] } : { url }).catch((error: unknown) => {
      if (isAbort(error)) return;
      reportClientError({ event: "share_failed", level: "warn", message: `${target}: ${describeError(error)}` });
      if (file) {
        downloadFile(file);
        toast.info(`Sdílení se nepodařilo, obrázek jsme stáhli — v aplikaci ${app} ho nahrajte z galerie.`);
      } else {
        toast.error("Sdílení se nepodařilo — zkopírujte odkaz a vložte ho do aplikace ručně.");
      }
    });
  };

  const shareElsewhere = () => {
    navigator.share({ title: event.title, url }).catch((error: unknown) => {
      if (isAbort(error)) return;
      reportClientError({ event: "share_failed", level: "warn", message: `elsewhere: ${describeError(error)}` });
      toast.error("Sdílení se nepodařilo.");
    });
  };

  const imagesReady = Boolean(files.post && files.story);
  const imageIcon = (icon: ReactNode) => (imagesReady ? icon : <Loader2 className="animate-spin" aria-hidden />);

  if (view.name === "phone") {
    const target = TARGETS[view.target];
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{target.title}</DialogTitle>
            <DialogDescription>Ve dvou krocích: nejdřív zkopírujete text, pak vyberete aplikaci.</DialogDescription>
          </DialogHeader>
          <MobileShareSteps
            appName={target.app}
            copyWhat={target.copies === "link" ? "odkaz na akci" : "text příspěvku"}
            copyText={target.copies === "link" ? url : caption}
            hints={target.hints}
            onShare={() => shareFromPhone(view.target)}
            onBack={() => setView({ name: "share" })}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {view.name === "facebook-event" ? (
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
              onPhone={touch}
              onBack={() => setView({ name: "share" })}
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
              <Button variant="outline" className="h-12 justify-start" onClick={() => choose("facebook-link")}>
                <Facebook className="text-[#1877F2]" aria-hidden />
                Odkaz s náhledem
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-start"
                disabled={!imagesReady}
                onClick={() => choose("facebook-image")}
              >
                {imageIcon(<ImageIcon className="text-[#1877F2]" aria-hidden />)}
                Příspěvek s obrázkem
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-start sm:col-span-2"
                onClick={() => setView({ name: "facebook-event" })}
              >
                <CalendarPlus className="text-[#1877F2]" aria-hidden />
                Vytvořit událost na Facebooku
              </Button>
            </Section>

            <Section title="Instagram">
              <Button
                variant="outline"
                className="h-12 justify-start"
                disabled={!imagesReady}
                onClick={() => choose("instagram-post")}
              >
                {imageIcon(<Instagram className="text-[#E4405F]" aria-hidden />)}
                Příspěvek
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-start"
                disabled={!imagesReady}
                onClick={() => choose("instagram-story")}
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
                    ? "Na telefonu vás provedeme dvěma kroky: zkopírování textu a výběr aplikace."
                    : "Na počítači se obrázek stáhne a otevře se Facebook nebo Instagram. Příběh jde přidat jen z telefonu."}
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
