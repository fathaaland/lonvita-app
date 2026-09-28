"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { removeProfileAvatar, setProfileAvatar } from "@/integrations/payload/queries";
import { ImageUploadError, prepareImageForUpload } from "@/lib/image";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The profile header's photo, with the pencil that opens the dialog to change or remove it. */
export function ProfileAvatarEditor() {
  const { profile, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
  }, [pendingPreview]);

  if (!profile) return null;

  const name = profile.full_name;
  const current = profile.avatar_url;
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
  };

  const save = async (action: () => Promise<void>, done: string, failed: string) => {
    setSaving(true);
    try {
      await action();
      await refreshProfile();
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
      async () => setProfileAvatar(profile.id, await prepareImageForUpload(pendingFile), name),
      "Fotka uložena.",
      "Fotku se nepodařilo uložit.",
    );

  const handleRemove = () =>
    save(() => removeProfileAvatar(profile.id), "Fotka odebrána.", "Fotku se nepodařilo odebrat.");

  return (
    <>
      <div className="relative">
        <UserAvatar
          name={name}
          src={current}
          className="h-24 w-24 ring-4 ring-card shadow-card"
          fallbackClassName="bg-card text-brand-purple-dark text-3xl font-extrabold"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute -bottom-1 -right-3 h-9 w-9 rounded-full inline-flex items-center justify-center bg-primary text-primary-foreground ring-4 ring-[hsl(var(--brand-purple-pale))] hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-ring"
          aria-label="Změnit profilovou fotku"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Profilová fotka</DialogTitle>
            <DialogDescription>
              Uvidí ji pořadatelé a ostatní účastníci akcí, na které jdete.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center py-2">
            <UserAvatar
              name={name}
              src={preview}
              className="h-40 w-40"
              fallbackClassName="bg-brand-purple-pale text-brand-purple-dark text-5xl font-extrabold"
            />
          </div>

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
