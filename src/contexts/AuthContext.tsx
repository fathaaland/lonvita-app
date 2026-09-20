"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { getCurrentPayloadUser, PayloadUser, signOutRedirect } from "@/integrations/payload/client";
import {
  getMyProfile,
  getMyRoles,
  getMyAdministeredMunicipalityIds,
  getMyOrganizerMunicipalityIds,
  ProfileRow,
  AppRole,
} from "@/integrations/payload/queries";

export type { AppRole };

interface AuthContextValue {
  user: PayloadUser | null;
  profile: ProfileRow | null;
  roles: AppRole[];
  loading: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isOrganizer: boolean;
  isPrescriber: boolean;
  /** Obce (by id) this account actually holds "municipality_admin"/"organizer" in — distinct
   * from `isAdmin`/`isOrganizer`, which are global flags. Used to scope nav links to the obec
   * currently being browsed (see `viewingMunicipalityId`), not every obec platform-wide. */
  administeredMunicipalityIds: string[];
  organizerMunicipalityIds: string[];
  /** The obec the home page's switcher is currently browsing (brief §2 "uživatel není vázaný
   * lokací"), kept here (not just local to "/") so nav chrome elsewhere can tell whether the
   * signed-in admin/organizer is looking at an obec they actually hold that role in — e.g. an
   * admin of Prague browsing Brno must not see "Vytvořit"/"Přehled obce" there. `null` = not yet
   * known/on the home page's default (treated as "own obec" by consumers). */
  viewingMunicipalityId: string | null;
  setViewingMunicipalityId: (id: string | null) => void;
  signOut: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PayloadUser | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [administeredMunicipalityIds, setAdministeredMunicipalityIds] = useState<string[]>([]);
  const [organizerMunicipalityIds, setOrganizerMunicipalityIds] = useState<string[]>([]);
  const [viewingMunicipalityId, setViewingMunicipalityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfileAndRoles = useCallback(async (userId: string) => {
    const [prof, roleRows, administeredIds, organizerIds] = await Promise.all([
      getMyProfile(userId),
      getMyRoles(userId),
      getMyAdministeredMunicipalityIds(userId),
      getMyOrganizerMunicipalityIds(userId),
    ]);
    setProfile(prof);
    setRoles(roleRows);
    setAdministeredMunicipalityIds(administeredIds);
    setOrganizerMunicipalityIds(organizerIds);
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const currentUser = await getCurrentPayloadUser();
      if (!active) return;

      setUser(currentUser);

      if (currentUser) {
        await loadProfileAndRoles(String(currentUser.id));
      } else {
        setProfile(null);
        setRoles([]);
        setAdministeredMunicipalityIds([]);
        setOrganizerMunicipalityIds([]);
        setViewingMunicipalityId(null);
      }

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [loadProfileAndRoles]);

  const refreshProfile = async () => {
    if (user) await loadProfileAndRoles(String(user.id));
  };

  const signOut = () => {
    signOutRedirect();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        roles,
        loading,
        // Platform-level flag (Users.role === 'admin'), distinct from the "isAdmin" /
        // "municipality_admin" community role below — a superadmin creates municipalities
        // and manages all users platform-wide, not just within one municipality.
        isSuperAdmin: user?.role === "admin",
        isAdmin: roles.includes("municipality_admin"),
        // A municipality admin can always do everything an organizer can, on top of their
        // own municipality-wide powers (brief §4 "Admin obce sám o příznak žádat nemusí").
        isOrganizer: roles.includes("organizer") || roles.includes("municipality_admin"),
        // Intervention/social-prescribing module isn't wired up in this backend yet.
        isPrescriber: false,
        administeredMunicipalityIds,
        organizerMunicipalityIds,
        viewingMunicipalityId,
        setViewingMunicipalityId,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
