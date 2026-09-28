import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function initialsOf(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

type UserAvatarProps = {
  name: string;
  src: string | null | undefined;
  className?: string;
  fallbackClassName?: string;
};

/** A person's profile photo, or their initials while it loads / when they haven't set one. */
export function UserAvatar({ name, src, className, fallbackClassName }: UserAvatarProps) {
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={name} className="object-cover" />}
      <AvatarFallback className={fallbackClassName}>{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}
