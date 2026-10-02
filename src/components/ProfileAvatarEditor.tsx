"use client";

import { useAuth } from "@/contexts/AuthContext";
import { removeProfileAvatar, setProfileAvatar } from "@/integrations/payload/queries";
import { AvatarEditor } from "@/components/AvatarEditor";
import { UserAvatar } from "@/components/UserAvatar";

/** The profile header's photo, with the pencil that opens the dialog to change or remove it. */
export function ProfileAvatarEditor() {
  const { profile, refreshProfile } = useAuth();
  if (!profile) return null;

  const name = profile.full_name;

  return (
    <AvatarEditor
      current={profile.avatar_url}
      renderAvatar={(src, size) =>
        size === "header" ? (
          <UserAvatar
            name={name}
            src={src}
            className="h-24 w-24 ring-4 ring-card shadow-card"
            fallbackClassName="bg-card text-brand-purple-dark text-3xl font-extrabold"
          />
        ) : (
          <UserAvatar
            name={name}
            src={src}
            className="h-40 w-40"
            fallbackClassName="bg-brand-purple-pale text-brand-purple-dark text-5xl font-extrabold"
          />
        )
      }
      title="Profilová fotka"
      description="Uvidí ji pořadatelé a ostatní účastníci akcí, na které jdete."
      editLabel="Změnit profilovou fotku"
      onSave={(file) => setProfileAvatar(profile.id, file, name)}
      onRemove={() => removeProfileAvatar(profile.id)}
      onChanged={refreshProfile}
    />
  );
}
