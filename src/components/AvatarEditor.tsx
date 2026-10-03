"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Move, Pencil, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ImageUploadError, cropToSquare, prepareImageForUpload } from "@/lib/image";
import { Button } from "@/components/ui/button";
import { CENTERED_IMAGE_POSITION, ImagePositionEditor, type ImagePosition } from "@/components/ImagePositionEditor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AvatarEditorProps = {
  /** The photo as it is now — null when there's none. */
  current: string | null;
  /** Draws the round avatar for a given photo (null = the fallback) — in the header and, larger, in the dialog. */
  renderAvatar: (src: string | null, size: "header" | "preview") => ReactNode;
  title: string;
  description: string;
  /** For the pencil button's accessible name, e.g. "Změnit profilovou fotku". */
  editLabel: string;
  onSave: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  /** Runs after a successful save or removal, e.g. to reload what shows the photo. */
  onChanged: () => Promise<void> | void;
};

/** A round photo with the pencil that opens the dialog to change or remove it — a person's profile
 * photo or an organization's photo/logo. */
export function AvatarEditor({
  current,
  renderAvatar,
  title,
  description,
  editLabel,
  onSave,
  onRemove,
  onChanged,
}: AvatarEditorProps) {
  const [open, setOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [position, setPosition] = useState<ImagePosition>(CENTERED_IMAGE_POSITION);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
  }, [pendingPreview]);

  const preview = pendingPreview ?? current;

  const reset = () => {
    setPendingFile(null);
    setPendingPreview(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (saving) return;
    if (!next) reset();
    setOpen(next);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
    setPosition(CENTERED_IMAGE_POSITION);
  };

  const save = async (action: () => Promise<void>, done: string, failed: string) => {
    setSaving(true);
    try {
      await action();
      await onChanged();
      toast.success(done);
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof ImageUploadError ? error.message : failed);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () =>
    pendingFile &&
    save(
      async () => onSave(await cropToSquare(await prepareImageForUpload(pendingFile), position)),
      "Fotka uložena.",
      "Fotku se nepodařilo uložit.",
    );

  const handleRemove = () => save(onRemove, "Fotka odebrána.", "Fotku se nepodařilo odebrat.");

  return (
    <>
      <div className="relative shrink-0">
        {renderAvatar(current, "header")}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute -bottom-1 -right-3 h-9 w-9 rounded-full inline-flex items-center justify-center bg-primary text-primary-foreground ring-4 ring-[hsl(var(--brand-purple-pale))] hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-ring"
          aria-label={editLabel}
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {pendingPreview ? (
            // A freshly picked photo is rarely square — the person drags it to choose what the circle shows.
            <div className="flex flex-col items-center gap-2 py-2">
              <ImagePositionEditor
                src={pendingPreview}
                value={position}
                onChange={setPosition}
                hint={false}
                className="h-40 w-40 rounded-full"
              />
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Move className="h-4 w-4" /> Přetažením nastavte výřez
              </p>
            </div>
          ) : (
            <div className="flex justify-center py-2">{renderAvatar(preview, "preview")}</div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />

          <DialogFooter className="gap-2 sm:flex-col sm:space-x-0">
            {pendingFile ? (
              <>
                <Button className="w-full h-12 text-base" onClick={handleSave} disabled={saving}>
                  {saving ? "Ukládám…" : "Uložit fotku"}
                </Button>
                <Button variant="outline" className="w-full h-12 text-base" onClick={reset} disabled={saving}>
                  Zpět
                </Button>
              </>
            ) : (
              <>
                <Button className="w-full h-12 text-base" onClick={() => fileInputRef.current?.click()} disabled={saving}>
                  <ImagePlus className="h-5 w-5" /> {current ? "Vybrat jinou fotku" : "Vybrat fotku"}
                </Button>
                {current && (
                  <Button
                    variant="outline"
                    className="w-full h-12 text-base text-destructive hover:text-destructive"
                    onClick={handleRemove}
                    disabled={saving}
                  >
                    <Trash2 className="h-5 w-5" /> {saving ? "Odebírám…" : "Odebrat fotku"}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
