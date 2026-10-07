"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarPlus, Copy, Facebook, Instagram, Link2, Loader2, Share2 } from "lucide-react";
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

type Target = "facebook-link" | "instagram-post" | "instagram-story";

/** Instagram's address — tapped on a phone, it opens the app (Instagram hands every path to it). */
const INSTAGRAM_URL = "https://www.instagram.com/";

/** What each way of sharing hands over: the generated image to save (Instagram picks it from the
 * gallery — it takes no image from the web), the text that goes with it — the caption, or for a
 * story, which has none, the link for Instagram's "Odkaz" sticker — and what to do in the app. */
const TARGETS: Record<
  Target,
  { title: string; app: "Facebook" | "Instagram"; format: ShareImageFormat | null; copies: "caption" | "link"; hints: string[] }
> = {
  "facebook-link": {
    title: "Facebook – odkaz s náhledem",
    app: "Facebook",
    format: null,
    copies: "caption",
    hints: [
      "Otevře se Facebook s náhledem akce — zkopírovaný text vložte nad něj.",
      "Když se náhled neukáže, vytvořte nový příspěvek a vložte zkopírovaný text: náhled se doplní sám z odkazu v něm.",
    ],
  },
  "instagram-post": {
    title: "Instagram – příspěvek",
    app: "Instagram",
    format: "post",
    copies: "caption",
    hints: [
      "V Instagramu klepněte na + → Příspěvek a vyberte uložený obrázek.",
      "Zkopírovaný text vložte jako popisek.",
    ],
  },
  "instagram-story": {
    title: "Instagram – příběh",
    app: "Instagram",
    format: "story",
    copies: "link",
    hints: [
      "V Instagramu klepněte na + → Příběh a vyberte uložený obrázek.",
      "Přidejte nálepku „Odkaz“ a vložte do ní zkopírovaný odkaz — jen tak jde na akci kliknout.",
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
 * Graph tags), or a hand-made Facebook event (FacebookEventGuide). Instagram: the generated image (it
 * takes no links from the web). Neither network lets a page prefill the post's text, so the suggested
 * text goes to the clipboard to paste.
 *
 * On a phone it goes step by step into the app (MobileShareSteps). On a computer Facebook's share
 * window opens, or the image is downloaded and Instagram's website opened.
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
  // A phone (or tablet): the apps are reached step by step, through links tapped there.
  const [touch, setTouch] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [canShareLink, setCanShareLink] = useState(false);
  // Facebook's and Instagram's own browser, where a shared link opens: images can't be saved from
  // it — they go out from a real browser.
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
        setFiles(loaded);
        setCanShareFiles(typeof navigator.canShare === "function" && navigator.canShare({ files: [loaded.post] }));
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
    if (touch) setView({ name: "phone", target });
    else if (target === "facebook-link") void shareLinkFromComputer();
    else void shareImageFromComputer(target);
  };

  /** Facebook's own share window — on a computer. */
  const shareLinkFromComputer = async () => {
    // Copied before the window opens — a document that has lost focus to it may not write to the
    // clipboard any more.
    const copied = await copyToClipboard(caption);
    const popup = window.open(facebookShareUrl(url), "facebook-share", "width=626,height=640");
    if (popup) popup.opener = null;
    if (copied) toast.success("Text příspěvku je zkopírovaný — na Facebooku ho vložte do příspěvku.");
    else toast.info("Text příspěvku zkopírujte z pole níže a vložte ho do příspěvku.");
  };

  /** Instagram from a computer: the image downloaded, Instagram's website opened for a post. */
  const shareImageFromComputer = async (target: Target) => {
    const { format, copies } = TARGETS[target];
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

    window.open(INSTAGRAM_URL, "_blank", "noopener,noreferrer");
    toast.success(
      copied
        ? "Obrázek je stažený a text zkopírovaný. Na Instagramu vytvořte příspěvek, nahrajte obrázek a vložte text."
        : "Obrázek je stažený. Na Instagramu vytvořte příspěvek a nahrajte ho, text zkopírujte z pole níže.",
      { duration: 10_000 },
    );
  };

  /** "Uložit obrázek" on a phone: the share sheet has "Uložit obrázek" (into the photos Instagram
   * picks from) — a plain download would land in Files on an iPhone. Without it, a download. */
  const saveImageOnPhone = (format: ShareImageFormat) => {
    const file = files[format];
    if (!file) return;
    if (!canShareFiles) {
      downloadFile(file);
      return;
    }
    toast.info("V nabídce zvolte „Uložit obrázek“.");
    navigator.share({ files: [file] }).catch((error: unknown) => {
      if (isAbort(error)) return;
      reportClientError({ event: "share_failed", level: "warn", message: `save ${format}: ${describeError(error)}` });
      toast.error("Uložení se nepodařilo — podržte prst na obrázku a zvolte „Přidat do Fotek“.");
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
    const format = target.format;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{target.title}</DialogTitle>
            <DialogDescription>
              {format
                ? `Tři kroky: uložit obrázek, zkopírovat ${target.copies === "link" ? "odkaz" : "text"}, otevřít Instagram.`
                : "Dva kroky: zkopírovat text, otevřít Facebook."}
            </DialogDescription>
          </DialogHeader>
          <MobileShareSteps
            appName={target.app}
            image={
              format
                ? { src: eventShareImagePath(event.id, format, event.updated_at), alt: `Obrázek akce ${event.title}` }
                : undefined
            }
            onSaveImage={format ? () => saveImageOnPhone(format) : undefined}
            copyWhat={target.copies === "link" ? "odkaz na akci" : "text příspěvku"}
            copyText={target.copies === "link" ? url : caption}
            openHref={target.app === "Facebook" ? facebookShareUrl(url) : INSTAGRAM_URL}
            hints={target.hints}
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
              <Button variant="outline" className="h-12 justify-start" onClick={() => setView({ name: "facebook-event" })}>
                <CalendarPlus className="text-[#1877F2]" aria-hidden />
                Vytvořit událost
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
                : inAppBrowser
                  ? "Jste v prohlížeči uvnitř Facebooku nebo Instagramu — obrázky odsud uložit nejdou. Otevřete stránku v Safari nebo Chrome (menu ⋯ → Otevřít v prohlížeči)."
                  : touch
                    ? "Na telefonu vás provedeme krok za krokem až do aplikace."
                    : "Na počítači se u Instagramu obrázek stáhne a otevře se instagram.com. Příběh jde přidat jen z telefonu."}
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
