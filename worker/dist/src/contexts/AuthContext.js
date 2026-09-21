"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getCurrentPayloadUser, signOutRedirect } from "@/integrations/payload/client";
import { getMyProfile, getMyRoles, getMyAdministeredMunicipalityIds, getMyOrganizerMunicipalityIds, } from "@/integrations/payload/queries";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [roles, setRoles] = useState([]);
    const [administeredMunicipalityIds, setAdministeredMunicipalityIds] = useState([]);
    const [organizerMunicipalityIds, setOrganizerMunicipalityIds] = useState([]);
    const [viewingMunicipalityId, setViewingMunicipalityId] = useState(null);
    const [loading, setLoading] = useState(true);
    const loadProfileAndRoles = useCallback(async (userId) => {
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
            if (!active)
                return;
            setUser(currentUser);
            if (currentUser) {
                await loadProfileAndRoles(String(currentUser.id));
            }
            else {
                setProfile(null);
                setRoles([]);
                setAdministeredMunicipalityIds([]);
                setOrganizerMunicipalityIds([]);
                setViewingMunicipalityId(null);
            }
            if (active)
                setLoading(false);
        })();
        return () => {
            active = false;
        };
    }, [loadProfileAndRoles]);
    const refreshProfile = async () => {
        if (user)
            await loadProfileAndRoles(String(user.id));
    };
    const signOut = () => {
        signOutRedirect();
    };
    return (_jsx(AuthContext.Provider, { value: {
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
        }, children: children }));
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
