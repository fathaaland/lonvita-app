"use client";

import { useState } from "react";
import { ArrowLeft, Check, Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/browserShare";

/**
 * Sharing to Facebook or Instagram on a phone, step by step: save the image (Instagram takes no
 * image from the web — it's picked from the gallery), copy the text, open the app. The app opens
 * from a real link the person taps: iOS (and Android) hand facebook.com / instagram.com links to the
 * installed app only then — never from script, and the share sheet didn't reliably get there.
 */
export function MobileShareSteps({
  appName,
  image,
  onSaveImage,
  copyWhat,
  copyText,
  openHref,
  hints,
  onBack,
}: {
  /** "Facebook" / "Instagram". */
  appName: string;
  /** The generated image to save to the phone first (Instagram), if any. */
  image?: { src: string; alt: string };
  /** Saves `image` — the share sheet's "Uložit obrázek", or a download. */
  onSaveImage?: () => void;
  /** What gets copied: "text příspěvku" or "odkaz na akci". */
  copyWhat: string;
  copyText: string;
  /** A facebook.com / instagram.com address — the app takes it over when the link is tapped. */
  openHref: string;
  /** What to do once the app is open. */
  hints: string[];
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyToClipboard(copyText)) {
      setCopied(true);
    } else {
      toast.error("Nepodařilo se zkopírovat — text pak napište ručně.");
    }
  };

  let step = 0;

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        {image && (
          <li className="space-y-2">
            <p className="text-sm font-semibold">{++step}. Uložte obrázek do telefonu</p>
            <img src={image.src} alt={image.alt} className="mx-auto max-h-64 w-auto rounded-lg border border-border" />
            <p className="text-xs text-muted-foreground">
              Podržte na obrázku prst a zvolte „Přidat do Fotek“ (na Androidu „Stáhnout obrázek“). Nebo:
            </p>
            {onSaveImage && (
              <Button variant="outline" className="h-12 w-full justify-start" onClick={onSaveImage}>
                <Download aria-hidden />
                Uložit obrázek
              </Button>
            )}
          </li>
        )}
        <li className="space-y-2">
          <p className="text-sm font-semibold">
            {++step}. Zkopírujte {copyWhat}
          </p>
          <Button variant="outline" className="h-12 w-full justify-start" onClick={copy}>
            {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Zkopírováno" : `Kopírovat ${copyWhat}`}
          </Button>
        </li>
        <li className="space-y-2">
          <p className="text-sm font-semibold">
            {++step}. Otevřete {appName}
          </p>
          <Button asChild className="h-12 w-full">
            <a href={openHref} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              Otevřít {appName}
            </a>
          </Button>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </li>
      </ol>
      <Button variant="ghost" className="h-11" onClick={onBack}>
        <ArrowLeft aria-hidden />
        Zpět na sdílení
      </Button>
    </div>
  );
}
