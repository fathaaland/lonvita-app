"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Loading } from "@/components/Loading";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const onboardingBypass = ["/onboarding", "/reset-password", "/auth"];
  // `profile` is `null` both while it's still loading AND for a signed-in user with no Profile
  // row at all (e.g. a first Google sign-in, before upsertUser's self-heal ran/landed) — by
  // the time `loading` is false those two cases are distinguishable: a real "no profile yet"
  // must still route to onboarding, not silently skip it like a signed-out visitor would.
  const needsOnboarding =
    !!user && (!profile || !profile.onboarding_completed) && !onboardingBypass.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth");
      return;
    }
    if (needsOnboarding) {
      router.replace("/onboarding");
    }
  }, [loading, user, needsOnboarding, router]);

  if (loading || !user || needsOnboarding) return <Loading />;

  return <>{children}</>;
}

export function RequireRole({
  children,
  role,
}: {
  children: ReactNode;
  role: "superadmin" | "municipality_admin" | "organizer";
}) {
  const { loading, isSuperAdmin, isAdmin, isOrganizer, refreshProfile } = useAuth();
  const router = useRouter();
  const ok = role === "superadmin" ? isSuperAdmin : role === "municipality_admin" ? isAdmin : isOrganizer;
  // Roles are loaded once per session — someone the obec has just made an organizer opens the
  // "schválena" notification with the old ones. Re-read them once before turning them away.
  const rechecking = useRef(false);
  const [rechecked, setRechecked] = useState(false);

  useEffect(() => {
    if (loading || ok) return;
    if (rechecked) {
      router.replace("/");
      return;
    }
    if (rechecking.current) return;
    rechecking.current = true;
    refreshProfile().finally(() => setRechecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, ok, rechecked, router]);

  if (loading || !ok) return <Loading />;
  return <>{children}</>;
}
