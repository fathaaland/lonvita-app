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
  const needsOnboarding =
    !!profile && !profile.onboarding_completed && !onboardingBypass.some((p) => pathname.startsWith(p));

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
  role: "municipality_admin" | "organizer";
}) {
  const { loading, isAdmin, isOrganizer } = useAuth();
  const router = useRouter();
  const ok = role === "municipality_admin" ? isAdmin : isOrganizer;

  useEffect(() => {
    if (!loading && !ok) router.replace("/");
  }, [loading, ok, router]);

  if (loading || !ok) return <Loading />;
  return <>{children}</>;
}
