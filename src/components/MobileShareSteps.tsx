"use client";

import { useState } from "react";
import { ArrowLeft, Check, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/browserShare";

/**
 * Sharing to Facebook or Instagram on a phone, as two taps: the text to the clipboard, then the
 * phone's share sheet (where the apps are). One tap can't do both reliably — Safari lets
 * navigator.share() through only straight from a tap and spends the tap on it, so the share sheet
 * gets a tap of its own with nothing else in it.
 */
export function MobileShareSteps({
  appName,
  copyWhat,
  copyText,
  hints,
  onShare,
  onBack,
}: {
  /** "Facebook" / "Instagram" — named on the share button. */
  appName: string;
  /** What step 1 copies: "text příspěvku" or "odkaz na akci". */
  copyWhat: string;
  copyText: string;
  /** What to do once the app is open. */
  hints: string[];
  /** Opens the share sheet — called straight from the tap. */
  onShare: () => void;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await copyToClipboard(copyText)) {
      setCopied(true);
    } else {
      toast.error("Nepodařilo se zkopírovat — v kroku 2 to přesto půjde, text pak napište ručně.");
    }
  };

  return (
    <div className="space-y-4">
      <ol className="space-y-4">
        <li className="space-y-2">
          <p className="text-sm font-semibold">1. Zkopírujte {copyWhat}</p>
          <Button variant="outline" className="h-12 w-full justify-start" onClick={copy}>
            {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Zkopírováno" : `Kopírovat ${copyWhat}`}
          </Button>
        </li>
        <li className="space-y-2">
          <p className="text-sm font-semibold">2. Otevřete {appName}</p>
          <Button className="h-12 w-full" onClick={onShare}>
            <Share2 aria-hidden />
            Sdílet do aplikace {appName}
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
