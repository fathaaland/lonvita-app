"use client";

import { ReactNode, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Loading } from "@/components/Loading";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const onboardingBypass = ["/onboarding", "/reset-password", "/auth"];
  // `profile` is `null` both while it's still loading AND for a signed-in user with no Profile
  // row at all (e.g. first Auth0/Google sign-in, before upsertUser's self-heal ran/landed) — by
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
  const { loading, isSuperAdmin, isAdmin, isOrganizer } = useAuth();
  const router = useRouter();
  const ok = role === "superadmin" ? isSuperAdmin : role === "municipality_admin" ? isAdmin : isOrganizer;

  useEffect(() => {
    if (!loading && !ok) router.replace("/");
  }, [loading, ok, router]);

  if (loading || !ok) return <Loading />;
  return <>{children}</>;
}
