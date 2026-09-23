"use client";

import { useEffect, useState } from "react";
import {
  listMunicipalitiesForSuperAdmin,
  createMunicipality,
  updateMunicipality,
  deleteMunicipality,
  createUserAsSuperAdmin,
  listAllUsersForSuperAdmin,
  updateUserAsSuperAdmin,
  deleteUserAsSuperAdmin,
  listAllEventsForSuperAdmin,
  grantCommunityRole,
  revokeCommunityRole,
  getAllOrganizerRequestsForSuperAdmin,
  getAllVolunteerFlagRequestsForSuperAdmin,
  getMunicipalityComparison,
  MunicipalityRow,
  PlatformUserRow,
  SuperAdminEventRow,
  SuperAdminOrganizerRequestRow,
  SuperAdminVolunteerFlagRequestRow,
  MunicipalityComparisonRow,
} from "@/integrations/payload/superadmin-queries";
import { decideOrganizerRequest, decideVolunteerFlagRequest } from "@/integrations/payload/admin-queries";
import { getEventCategories, createEvent, listMunicipalities } from "@/integrations/payload/queries";
import type { MunicipalityMapPoint } from "@/components/map/MunicipalitiesMap";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { CancelEventButton } from "@/components/CancelEventButton";
import { EventForm, EventFormValues } from "@/components/EventForm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Building2, Users as UsersIcon, CalendarPlus, Shield, X, UserPlus, LogOut, MapPin, Pencil, ClipboardList, Check, HandHeart, BarChart3 } from "lucide-react";
import { pct } from "@/lib/report";
import { toast } from "sonner";
import type { CategoryRow } from "@/lib/analytics";
import { LocationPicker } from "@/components/map/LocationPickerClient";
import type { PickedLocation } from "@/components/map/LocationPicker";
import { MunicipalitiesMap } from "@/components/map/MunicipalitiesMapClient";
import { formatEventDateTime, toDateInputValue } from "@/lib/date";
import Link from "next/link";
import { cn } from "@/lib/utils";

const CZECHIA_CENTER: [number, number] = [49.8175, 15.473];

// Same lenient Czech format as the onboarding phone step.
const PHONE_RE = /^(\+420|00420)?\s?[0-9]{3}\s?[0-9]{3}\s?[0-9]{3}$/;

const ROLE_LABEL: Record<string, string> = {
  participant: "Účastník",
  municipality_admin: "Admin obce",
  organizer: "Organizátor",
  prescriber: "Prescriber",
};

/** Radix Select has no empty-string value, so "bez obce" needs a sentinel of its own. */
const NO_MUNICIPALITY = "none";

/** Roles that make someone a legitimate pořadatel in an obec — the same pair Events' own
 * `requireOrganizerRole` hook checks server-side. */
const ORGANIZER_ROLES = ["municipality_admin", "organizer"] as const;

type Gender = "zena" | "muz" | "jine" | "neuvedeno";

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "zena", label: "Žena" },
  { value: "muz", label: "Muž" },
  { value: "jine", label: "Jiné" },
  { value: "neuvedeno", label: "Neuvedeno" },
];

const chipClass = (active: boolean) =>
  cn(
    "px-3 py-2 rounded-full text-sm font-semibold border-[1.5px] transition-colors",
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-card text-foreground border-border hover:border-brand-purple",
  );

function SuperAdminContent() {
  const { signOut } = useAuth();
  const [tab, setTab] = useState("municipalities");
  const [municipalities, setMunicipalities] = useState<MunicipalityRow[]>([]);
  const [mapPoints, setMapPoints] = useState<MunicipalityMapPoint[]>([]);
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [events, setEvents] = useState<SuperAdminEventRow[]>([]);
  const [orgRequests, setOrgRequests] = useState<SuperAdminOrganizerRequestRow[]>([]);
  const [volRequests, setVolRequests] = useState<SuperAdminVolunteerFlagRequestRow[]>([]);
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Obce tab — list vs. side-by-side comparison view
  const [muniView, setMuniView] = useState<"list" | "comparison">("list");
  const [comparison, setComparison] = useState<MunicipalityComparisonRow[] | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Obce tab — new municipality form
  const [muniName, setMuniName] = useState("");
  const [muniDescription, setMuniDescription] = useState("");
  const [muniLocation, setMuniLocation] = useState<PickedLocation | null>(null);
  const [creatingMuni, setCreatingMuni] = useState(false);

  // Obce tab — edit existing municipality (inline, one at a time)
  const [editingMuniId, setEditingMuniId] = useState<string | null>(null);
  const [editMuniName, setEditMuniName] = useState("");
  const [editMuniDescription, setEditMuniDescription] = useState("");
  const [editMuniLocation, setEditMuniLocation] = useState<PickedLocation | null>(null);
  const [savingMuni, setSavingMuni] = useState(false);

  // Uživatelé tab — new user form: the same data a self-signup gives across registration
  // (/auth: home obec on the map or "bez obce") and onboarding (date of birth, gender, interests, phone).
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newUserMuniId, setNewUserMuniId] = useState("");
  const [newNoMunicipality, setNewNoMunicipality] = useState(false);
  const [newDob, setNewDob] = useState("");
  const [newGender, setNewGender] = useState<Gender>("neuvedeno");
  const [newPhone, setNewPhone] = useState("");
  const [newInterests, setNewInterests] = useState<string[]>([]);
  const [creatingUser, setCreatingUser] = useState(false);

  // Uživatelé tab — edit an existing account (the pencil next to the bin). Profile data only:
  // the platform role isn't editable anywhere anymore (Users.role field access), the e-mail is
  // what Google sign-ins are matched on, and obec roles live in the Role tab.
  const [editUser, setEditUser] = useState<PlatformUserRow | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUserMuniId, setEditUserMuniId] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editGender, setEditGender] = useState<Gender>("neuvedeno");
  const [editPhone, setEditPhone] = useState("");
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [savingUser, setSavingUser] = useState(false);

  // Role tab — revoking someone's last obec role deletes the account with it, so that one
  // needs its own confirm (the other revokes are a single click, as before).
  const [lastRoleRevoke, setLastRoleRevoke] = useState<PlatformUserRow | null>(null);
  const [deletingLastRole, setDeletingLastRole] = useState(false);

  // Akce tab — new event form. Superadmin picks obec + pořadatel first (an organizer/admin's
  // own /vytvorit derives these from their own roles instead), then gets the exact same
  // EventForm every organizer/admin uses (brief §2 "flow ... musí kopírovat" — 1:1, not a
  // separate hand-rolled form).
  const [evMuniId, setEvMuniId] = useState("");
  const [evOrganizerId, setEvOrganizerId] = useState("");
  // Bumped after each successful create to remount EventForm with a clean slate — it owns its
  // own internal state, so there's nothing here to reset otherwise.
  const [eventFormKey, setEventFormKey] = useState(0);

  // Role tab — grant form
  const [grantUserId, setGrantUserId] = useState("");
  const [grantMuniId, setGrantMuniId] = useState("");
  const [granting, setGranting] = useState(false);

  const load = async () => {
    setLoading(true);
    // "Porovnání" used to be fetched once and cached forever, so every event/user/role mutation
    // made elsewhere in the panel silently went stale there until a full page reload (brief §3
    // "prubezne propisovani do porovnani"). load() is the one function every mutation handler
    // below already calls, so folding the comparison refetch in here — whenever that view is the
    // one on screen — keeps it live without threading a refetch through each handler individually.
    const wantsComparison = muniView === "comparison";
    const [munis, points, us, cats, evs, orgReqs, volReqs, comp] = await Promise.all([
      listMunicipalitiesForSuperAdmin(),
      listMunicipalities(),
      listAllUsersForSuperAdmin(),
      getEventCategories(),
      listAllEventsForSuperAdmin(),
      getAllOrganizerRequestsForSuperAdmin(),
      getAllVolunteerFlagRequestsForSuperAdmin(),
      wantsComparison ? getMunicipalityComparison() : Promise.resolve(null),
    ]);
    setMunicipalities(munis);
    setMapPoints(points);
    setUsers(us);
    setCategories(cats);
    setEvents(evs);
    setOrgRequests(orgReqs);
    setVolRequests(volReqs);
    if (wantsComparison) setComparison(comp);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateMunicipality = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!muniName.trim()) {
      toast.error("Zadejte název obce.");
      return;
    }
    if (!muniLocation) {
      toast.error("Vyberte polohu obce na mapě.");
      return;
    }
    setCreatingMuni(true);
    try {
      await createMunicipality({
        name: muniName.trim(),
        description: muniDescription.trim() || undefined,
        lat: muniLocation.lat,
        lng: muniLocation.lng,
      });
      toast.success("Obec vytvořena.");
      setMuniName("");
      setMuniDescription("");
      setMuniLocation(null);
      load();
    } catch {
      toast.error("Nepodařilo se vytvořit obec.");
    } finally {
      setCreatingMuni(false);
    }
  };

  const startEditMuni = (m: MunicipalityRow) => {
    setEditingMuniId(m.id);
    setEditMuniName(m.name);
    setEditMuniDescription(m.description ?? "");
    const point = mapPoints.find((p) => p.id === m.id);
    setEditMuniLocation(point ? { lat: point.lat, lng: point.lng, label: point.name } : null);
  };

  const cancelEditMuni = () => setEditingMuniId(null);

  const handleSaveMuni = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMuniId || !editMuniName.trim() || !editMuniLocation) return;
    setSavingMuni(true);
    try {
      await updateMunicipality(editingMuniId, {
        name: editMuniName.trim(),
        description: editMuniDescription.trim() || undefined,
        lat: editMuniLocation.lat,
        lng: editMuniLocation.lng,
      });
      toast.success("Obec upravena.");
      setEditingMuniId(null);
      load();
    } catch (error) {
      toast.error(error instanceof PayloadApiError ? error.message : "Nepodařilo se uložit obec.");
    } finally {
      setSavingMuni(false);
    }
  };

  const handleDeleteMuni = async (id: string) => {
    await deleteMunicipality(id);
    toast.success("Obec smazána.");
    load();
  };

  const startEditUser = (u: PlatformUserRow) => {
    setEditUser(u);
    setEditFullName(u.fullName ?? "");
    setEditUserMuniId(u.homeMunicipalityId ?? "");
    setEditDob(u.dateOfBirth ?? "");
    setEditGender(u.gender);
    setEditPhone(u.phone ?? "");
    setEditInterests(u.interestIds);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser?.profileId) return;
    if (!editFullName.trim()) {
      toast.error("Zadejte celé jméno.");
      return;
    }
    if (editPhone.trim() && !PHONE_RE.test(editPhone.trim())) {
      toast.error("Zadejte platné české telefonní číslo.");
      return;
    }
    setSavingUser(true);
    try {
      await updateUserAsSuperAdmin(editUser.profileId, {
        fullName: editFullName.trim(),
        municipalityId: editUserMuniId || null,
        dateOfBirth: editDob || null,
        gender: editGender,
        phone: editPhone.trim() || null,
        interestIds: editInterests,
      });
      toast.success("Uživatel upraven.");
      setEditUser(null);
      load();
    } catch (error) {
      toast.error(error instanceof PayloadApiError ? error.message : "Nepodařilo se uložit uživatele.");
    } finally {
      setSavingUser(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    await deleteUserAsSuperAdmin(id);
    toast.success("Uživatel smazán.");
    load();
  };

  const resetNewUserForm = () => {
    setNewFullName("");
    setNewEmail("");
    setNewPassword("");
    setNewUserMuniId("");
    setNewNoMunicipality(false);
    setNewDob("");
    setNewGender("neuvedeno");
    setNewPhone("");
    setNewInterests([]);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim() || !newEmail.trim() || !newPassword) {
      toast.error("Vyplňte jméno, e-mail a heslo.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Heslo musí mít alespoň 8 znaků.");
      return;
    }
    if (!newUserMuniId && !newNoMunicipality) {
      toast.error("Vyberte obec na mapě, nebo zaškrtněte „bez obce“.");
      return;
    }
    if (newPhone.trim() && !PHONE_RE.test(newPhone.trim())) {
      toast.error("Zadejte platné české telefonní číslo.");
      return;
    }
    setCreatingUser(true);
    try {
      await createUserAsSuperAdmin({
        email: newEmail.trim(),
        password: newPassword,
        fullName: newFullName.trim(),
        municipalityId: newNoMunicipality ? null : newUserMuniId,
        dateOfBirth: newDob || null,
        gender: newGender,
        phone: newPhone.trim() || null,
        interestIds: newInterests,
      });
      toast.success(
        newDob && newPhone.trim()
          ? "Uživatel vytvořen."
          : "Uživatel vytvořen. Chybějící údaje (datum narození, telefon) doplní při prvním přihlášení.",
      );
      resetNewUserForm();
      load();
    } catch {
      toast.error("Nepodařilo se vytvořit uživatele — e-mail už možná existuje.");
    } finally {
      setCreatingUser(false);
    }
  };

  // Same call shape as /vytvorit's handleSubmit — the only difference is organizer + obec come
  // from the pickers above instead of the logged-in user's own roles.
  const handleCreateEvent = async (values: EventFormValues) => {
    try {
      await createEvent({
        title: values.title,
        description: values.description,
        dateTimeIso: values.dateTimeIso,
        endDateTimeIso: values.endDateTimeIso ?? undefined,
        recurrenceRule: values.recurrenceRule ?? undefined,
        locationText: values.location.label,
        lat: values.location.lat,
        lng: values.location.lng,
        accessibilityTags: values.accessibilityTags,
        capacity: values.capacity,
        registrationApprovalMode: values.registrationApprovalMode,
        organizerUserId: evOrganizerId,
        municipalityId: evMuniId,
        coOrganizerIds: values.coOrganizerIds,
        categoryIds: values.categoryIds,
        imageId: values.imageId ?? undefined,
        imagePositionX: values.imagePosition.x,
        imagePositionY: values.imagePosition.y,
        isVolunteering: values.isVolunteering,
        isPaid: values.isPaid,
        priceCents: values.priceCents ?? undefined,
      });
      toast.success("Akce vytvořena.");
      setEventFormKey((k) => k + 1);
      await load();
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status === 400 ? error.message : "Nepodařilo se vytvořit akci.",
      );
    }
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantUserId || !grantMuniId) {
      toast.error("Vyberte uživatele a obec.");
      return;
    }
    setGranting(true);
    try {
      await grantCommunityRole(grantUserId, grantMuniId, "municipality_admin");
      toast.success("Role přidána.");
      setGrantUserId("");
      setGrantMuniId("");
      load();
    } catch {
      toast.error("Nepodařilo se přidat roli — uživatel ji už možná má.");
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (userRoleId: string) => {
    try {
      await revokeCommunityRole(userRoleId);
      toast.success("Role odebrána.");
      load();
    } catch {
      toast.error("Nepodařilo se odebrat roli.");
    }
  };

  /** Taking away someone's only remaining obec role leaves an account that belongs nowhere, so
   * it goes with the role. Deleting the user is enough on its own — Users' beforeDelete hook
   * clears their user-roles row (and the rest of their data) in the same transaction, so there's
   * no window where the role is gone but the account isn't. */
  const handleDeleteWithLastRole = async () => {
    if (!lastRoleRevoke) return;
    setDeletingLastRole(true);
    try {
      await deleteUserAsSuperAdmin(lastRoleRevoke.id);
      toast.success("Poslední role odebrána — účet smazán.");
      setLastRoleRevoke(null);
      load();
    } catch (error) {
      toast.error(error instanceof PayloadApiError ? error.message : "Uživatele se nepodařilo smazat.");
    } finally {
      setDeletingLastRole(false);
    }
  };

  const handleShowComparison = async () => {
    setMuniView("comparison");
    // Always refetch — load() only refreshes this while the view is already open (see load()'s
    // comment), so switching into it needs its own fetch too. No caching: this is a superadmin
    // ops panel, not a hot path, and stale numbers here are exactly the bug being fixed.
    setLoadingComparison(true);
    try {
      setComparison(await getMunicipalityComparison());
    } catch {
      toast.error("Nepodařilo se načíst porovnání obcí.");
    } finally {
      setLoadingComparison(false);
    }
  };

  const handleOrganizerRequestDecision = async (id: string, approve: boolean) => {
    setRequestBusyId(id);
    try {
      await decideOrganizerRequest(id, approve);
      toast.success(approve ? "Role organizátora schválena." : "Žádost zamítnuta.");
      await load();
    } catch {
      toast.error("Nepodařilo se vyřídit žádost.");
    } finally {
      setRequestBusyId(null);
    }
  };

  const handleVolunteerRequestDecision = async (id: string, approve: boolean) => {
    setRequestBusyId(id);
    try {
      await decideVolunteerFlagRequest(id, approve);
      toast.success(approve ? "Příznak Dobrovolnictví schválen." : "Žádost zamítnuta.");
      await load();
    } catch {
      toast.error("Nepodařilo se vyřídit žádost.");
    } finally {
      setRequestBusyId(null);
    }
  };

  const logoutAction = (
    <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
      <LogOut className="h-4 w-4" />
      Odhlásit
    </Button>
  );

  if (loading) return <><PageHeader title="Superadmin" right={logoutAction} /><Loading /></>;

  const newUserMuniName = mapPoints.find((m) => m.id === newUserMuniId)?.name;
  const evMuniPoint = mapPoints.find((m) => m.id === evMuniId);
  const evMuniCenter: [number, number] = evMuniPoint ? [evMuniPoint.lat, evMuniPoint.lng] : CZECHIA_CENTER;
  // Only people who already organize in the chosen obec. A superadmin used to be able to file
  // an obec's event under any účastník at all; now the role comes first (Events' own
  // `requireOrganizerRole` hook enforces the same thing server-side).
  const evOrganizerOptions = evMuniId
    ? users.filter((u) =>
        u.communityRoles.some(
          (r) => r.municipalityId === evMuniId && ORGANIZER_ROLES.includes(r.role as (typeof ORGANIZER_ROLES)[number]),
        ),
      )
    : [];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Superadmin" right={logoutAction} />
      {/* Wider on large screens so the municipality/location maps in these forms get room too. */}
      <div className="px-4 py-5 max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full h-14 grid grid-cols-5">
            <TabsTrigger value="municipalities" className="flex-col gap-0.5 text-[11px]">
              <Building2 className="h-4 w-4" /> Obce
            </TabsTrigger>
            <TabsTrigger value="users" className="flex-col gap-0.5 text-[11px]">
              <UsersIcon className="h-4 w-4" /> Uživatelé
            </TabsTrigger>
            <TabsTrigger value="events" className="flex-col gap-0.5 text-[11px]">
              <CalendarPlus className="h-4 w-4" /> Akce
            </TabsTrigger>
            <TabsTrigger value="roles" className="flex-col gap-0.5 text-[11px]">
              <Shield className="h-4 w-4" /> Role
            </TabsTrigger>
            <TabsTrigger value="requests" className="relative flex-col gap-0.5 text-[11px]">
              <ClipboardList className="h-4 w-4" /> Žádosti
              {orgRequests.length + volRequests.length > 0 && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] absolute -top-1 -right-1">
                  {orgRequests.length + volRequests.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* --- Obce ------------------------------------------------------------------ */}
          <TabsContent value="municipalities" className="pt-4 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="eyebrow">
                  <Building2 className="h-3 w-3" /> Nová obec
                </div>
                <form onSubmit={handleCreateMunicipality} className="space-y-3">
                  <div>
                    <Label htmlFor="muni-name">Název obce *</Label>
                    <Input id="muni-name" value={muniName} onChange={(e) => setMuniName(e.target.value)} className="h-11 mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="muni-desc">Popis</Label>
                    <Textarea
                      id="muni-desc"
                      value={muniDescription}
                      onChange={(e) => setMuniDescription(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label>Poloha na mapě *</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Šedé tečky jsou už založené obce — vyberte místo mimo ně.
                    </p>
                    <div className="mt-1.5">
                      <LocationPicker
                        value={muniLocation}
                        onChange={setMuniLocation}
                        initialCenter={CZECHIA_CENTER}
                        existingPoints={mapPoints}
                      />
                    </div>
                  </div>
                  <Button type="submit" disabled={creatingMuni} className="w-full h-11">
                    Vytvořit obec
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="flex gap-1 bg-muted rounded-lg p-1 max-w-xs">
              <button
                onClick={() => setMuniView("list")}
                className={`flex-1 h-9 rounded-md text-sm font-semibold transition-colors ${
                  muniView === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Seznam
              </button>
              <button
                onClick={handleShowComparison}
                className={`flex-1 h-9 rounded-md text-sm font-semibold transition-colors ${
                  muniView === "comparison" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Porovnání
              </button>
            </div>

            {muniView === "comparison" ? (
              loadingComparison || comparison === null ? (
                <p className="text-center text-muted-foreground py-8">Načítám…</p>
              ) : comparison.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Žádné obce k porovnání.</p>
              ) : (
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-3 font-semibold sticky left-0 bg-muted/50">Obec</th>
                          <th className="p-3 font-semibold text-right">Akcí (90 dní)</th>
                          <th className="p-3 font-semibold text-right">Účastníků</th>
                          <th className="p-3 font-semibold text-right">Naplněnost</th>
                          <th className="p-3 font-semibold text-right">Organizátorů</th>
                          <th className="p-3 font-semibold text-right">Datavita</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparison
                          .slice()
                          .sort((a, b) => (b.metrics.datavita.current ?? -1) - (a.metrics.datavita.current ?? -1))
                          .map((c) => (
                            <tr key={c.municipality_id} className="border-t border-border">
                              <td className="p-3 font-medium whitespace-nowrap sticky left-0 bg-background">{c.municipality_name}</td>
                              <td className="p-3 text-right tabular-nums">{c.metrics.current.eventsCount}</td>
                              <td className="p-3 text-right tabular-nums">{c.metrics.current.participantsUnique}</td>
                              <td className="p-3 text-right tabular-nums">{pct(c.metrics.current.avgFillRate)}</td>
                              <td className="p-3 text-right tabular-nums">{c.metrics.current.activeOrganizers}</td>
                              <td className="p-3 text-right tabular-nums font-bold">
                                {c.metrics.datavita.current ?? "—"}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )
            ) : (
            <div className="space-y-2">
              {municipalities.map((m) =>
                editingMuniId === m.id ? (
                  <Card key={m.id}>
                    <CardContent className="p-4">
                      <form onSubmit={handleSaveMuni} className="space-y-3">
                        <div>
                          <Label htmlFor="edit-muni-name">Název obce *</Label>
                          <Input
                            id="edit-muni-name"
                            value={editMuniName}
                            onChange={(e) => setEditMuniName(e.target.value)}
                            className="h-11 mt-1.5"
                          />
                        </div>
                        <div>
                          <Label htmlFor="edit-muni-desc">Popis</Label>
                          <Textarea
                            id="edit-muni-desc"
                            value={editMuniDescription}
                            onChange={(e) => setEditMuniDescription(e.target.value)}
                            className="mt-1.5"
                          />
                        </div>
                        <div>
                          <Label>Poloha na mapě *</Label>
                          <div className="mt-1.5">
                            <LocationPicker
                              value={editMuniLocation}
                              onChange={setEditMuniLocation}
                              initialCenter={CZECHIA_CENTER}
                              existingPoints={mapPoints.filter((p) => p.id !== m.id)}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" disabled={savingMuni} className="flex-1 h-11">
                            Uložit
                          </Button>
                          <Button type="button" variant="outline" onClick={cancelEditMuni} className="flex-1 h-11">
                            Zrušit
                          </Button>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                ) : (
                  <Card key={m.id}>
                    <CardContent className="p-4 flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold truncate">{m.name}</p>
                        {m.description && <p className="text-sm text-muted-foreground mt-0.5 truncate">{m.description}</p>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => startEditMuni(m)} aria-label="Upravit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <ConfirmDeleteButton
                        title={`Smazat obec „${m.name}“?`}
                        description="Smazání obce nejde vrátit zpět a nepůjde, pokud na ni ještě odkazují uživatelé nebo akce."
                        onConfirm={() => handleDeleteMuni(m.id)}
                        errorMessage="Obec se nepodařilo smazat — pravděpodobně na ni ještě odkazují uživatelé nebo akce."
                      />
                    </CardContent>
                  </Card>
                ),
              )}
            </div>
            )}
          </TabsContent>

          {/* --- Uživatelé -------------------------------------------------------------- */}
          <TabsContent value="users" className="pt-4 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="eyebrow">
                  <UserPlus className="h-3 w-3" /> Nový uživatel
                </div>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div>
                    <Label htmlFor="u-name">Celé jméno *</Label>
                    <Input id="u-name" value={newFullName} onChange={(e) => setNewFullName(e.target.value)} className="h-11 mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="u-email">E-mail *</Label>
                    <Input
                      id="u-email"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="h-11 mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="u-pass">Heslo *</Label>
                    <Input
                      id="u-pass"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-11 mt-1.5"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Obec *</Label>
                    {!newNoMunicipality && (
                      <>
                        <MunicipalitiesMap
                          points={mapPoints}
                          selectedId={newUserMuniId || null}
                          onSelect={setNewUserMuniId}
                        />
                        {newUserMuniName && (
                          <div className="flex items-center gap-1.5 text-sm font-semibold justify-center">
                            <MapPin className="h-4 w-4 text-primary" />
                            {newUserMuniName}
                          </div>
                        )}
                      </>
                    )}
                    <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={newNoMunicipality}
                        onCheckedChange={(v) => {
                          const on = v === true;
                          setNewNoMunicipality(on);
                          if (on) setNewUserMuniId("");
                        }}
                        className="mt-0.5"
                      />
                      <span>Bez obce — uživatel uvidí akce ze všech obcí.</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="u-dob">Datum narození</Label>
                      <Input
                        id="u-dob"
                        type="date"
                        min="1920-01-01"
                        max={toDateInputValue()}
                        value={newDob}
                        onChange={(e) => setNewDob(e.target.value)}
                        className="h-11 mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="u-phone">Telefon</Label>
                      <Input
                        id="u-phone"
                        type="tel"
                        placeholder="+420 601 234 567"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        className="h-11 mt-1.5"
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Pohlaví</Label>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {GENDER_OPTIONS.map((g) => (
                        <button key={g.value} type="button" onClick={() => setNewGender(g.value)} className={chipClass(newGender === g.value)}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label>Zájmy</Label>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {categories.map((c) => {
                        const active = newInterests.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setNewInterests((prev) => (active ? prev.filter((id) => id !== c.id) : [...prev, c.id]))
                            }
                            className={chipClass(active)}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Když datum narození nebo telefon nevyplníte, uživatel je doplní v onboardingu při prvním přihlášení.
                  </p>

                  <Button type="submit" disabled={creatingUser} className="w-full h-11">
                    Vytvořit uživatele
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {users.map((u) => (
                <Card key={u.id}>
                  <CardContent className="p-4 flex items-center gap-2.5">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                        {(u.fullName ?? u.email).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold truncate">{u.fullName ?? "Bez profilu"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.email}
                        {u.homeMunicipalityName ? ` · ${u.homeMunicipalityName}` : u.fullName ? " · bez obce" : ""}
                      </p>
                    </div>
                    {u.platformRole === "admin" && (
                      <Badge variant="secondary" className="shrink-0">
                        Superadmin
                      </Badge>
                    )}
                    {/* Platform role is deliberately not editable from here — a superadmin can't
                        hand that role to anyone (Users.role is locked server-side too). The pencil
                        edits the account's profile data instead. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      onClick={() => startEditUser(u)}
                      disabled={!u.profileId}
                      aria-label="Upravit uživatele"
                      title={u.profileId ? "Upravit uživatele" : "Účet zatím nemá profil"}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmDeleteButton
                      title={`Smazat uživatele „${u.fullName ?? u.email}“?`}
                      description="Smazání účtu nejde vrátit zpět. Smaže se i profil, role, přihlášky na akce a oznámení."
                      onConfirm={() => handleDeleteUser(u.id)}
                      errorMessage="Uživatele se nepodařilo smazat."
                    />
                  </CardContent>
                </Card>
              ))}
            </div>

            <Dialog open={editUser !== null} onOpenChange={(open) => !open && !savingUser && setEditUser(null)}>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Upravit uživatele</DialogTitle>
                  <DialogDescription>
                    {editUser?.email} — e-mail ani platformní roli odsud měnit nelze. E-mailem se účet páruje
                    s přihlášením, role obce se přiřazují v záložce „Role“.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSaveUser} className="space-y-4">
                  <div>
                    <Label htmlFor="eu-name">Celé jméno *</Label>
                    <Input
                      id="eu-name"
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      className="h-11 mt-1.5"
                    />
                  </div>
                  <div>
                    <Label>Obec</Label>
                    <Select
                      value={editUserMuniId || NO_MUNICIPALITY}
                      onValueChange={(v) => setEditUserMuniId(v === NO_MUNICIPALITY ? "" : v)}
                    >
                      <SelectTrigger className="h-11 mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_MUNICIPALITY}>Bez obce — vidí akce ze všech obcí</SelectItem>
                        {municipalities.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="eu-dob">Datum narození</Label>
                      <Input
                        id="eu-dob"
                        type="date"
                        min="1920-01-01"
                        max={toDateInputValue()}
                        value={editDob}
                        onChange={(e) => setEditDob(e.target.value)}
                        className="h-11 mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="eu-phone">Telefon</Label>
                      <Input
                        id="eu-phone"
                        type="tel"
                        placeholder="+420 601 234 567"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="h-11 mt-1.5"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Pohlaví</Label>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {GENDER_OPTIONS.map((g) => (
                        <button
                          key={g.value}
                          type="button"
                          onClick={() => setEditGender(g.value)}
                          className={chipClass(editGender === g.value)}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Zájmy</Label>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {categories.map((c) => {
                        const active = editInterests.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() =>
                              setEditInterests((prev) => (active ? prev.filter((id) => id !== c.id) : [...prev, c.id]))
                            }
                            className={chipClass(active)}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setEditUser(null)} disabled={savingUser}>
                      Zrušit
                    </Button>
                    <Button type="submit" disabled={savingUser}>
                      {savingUser ? "Ukládám…" : "Uložit"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* --- Akce -------------------------------------------------------------------- */}
          <TabsContent value="events" className="pt-4 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="eyebrow">
                  <CalendarPlus className="h-3 w-3" /> Nová akce
                </div>
                <p className="text-xs text-muted-foreground">
                  Obec a pořadatel se vybírají tady — organizátor a admin obce mají tyhle dvě věci dané
                  vlastní rolí, superadmin je vybírá ručně. Zbytek je přesně ten samý formulář jako na „Vytvořit akci“.
                </p>
                <div>
                  <Label>Obec *</Label>
                  <Select
                    value={evMuniId}
                    onValueChange={(v) => {
                      setEvMuniId(v);
                      // The eligible pořadatelé differ per obec — a pick from the previous one
                      // would silently stay selected (and be rejected on submit).
                      setEvOrganizerId("");
                    }}
                  >
                    <SelectTrigger className="h-11 mt-1.5">
                      <SelectValue placeholder="Vyberte obec" />
                    </SelectTrigger>
                    <SelectContent>
                      {municipalities.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Pořadatel *</Label>
                  <Select value={evOrganizerId} onValueChange={setEvOrganizerId} disabled={!evMuniId}>
                    <SelectTrigger className="h-11 mt-1.5">
                      <SelectValue placeholder={evMuniId ? "Vyberte pořadatele" : "Nejdřív vyberte obec"} />
                    </SelectTrigger>
                    <SelectContent>
                      {evOrganizerOptions.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.fullName ?? u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {evMuniId && evOrganizerOptions.length === 0
                      ? "V téhle obci zatím nikdo nemá roli „Admin obce“ ani „Organizátor“. Přiřaďte ji v záložce „Role“, potom půjde akci vytvořit."
                      : "Nabízí se jen lidé s rolí „Admin obce“ nebo „Organizátor“ ve vybrané obci."}
                  </p>
                </div>
              </CardContent>
            </Card>

            {evMuniId && evOrganizerId ? (
              <Card>
                <CardContent className="p-0">
                  <EventForm
                    key={eventFormKey}
                    userId={evOrganizerId}
                    municipalityId={evMuniId}
                    municipalityCenter={evMuniCenter}
                    canSetVolunteering
                    submitLabel="Vytvořit akci"
                    onSubmit={handleCreateEvent}
                  />
                </CardContent>
              </Card>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-6">Nejdřív vyberte obec a pořadatele.</p>
            )}

            <div className="space-y-2">
              {events.map((ev) => (
                <Card key={ev.id}>
                  <CardContent className="p-4 flex items-center gap-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold truncate">{ev.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {formatEventDateTime(ev.dateTimeIso)} · {ev.municipalityName}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
                      <Link href={`/upravit/${ev.id}`} aria-label="Upravit akci">
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <CancelEventButton eventId={ev.id} title={ev.title} dateTime={ev.dateTimeIso} variant="icon" onCancelled={load} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* --- Role -------------------------------------------------------------------- */}
          <TabsContent value="roles" className="pt-4 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="eyebrow">
                  <Shield className="h-3 w-3" /> Přiřadit roli „Admin obce“
                </div>
                <form onSubmit={handleGrant} className="space-y-3">
                  <Select value={grantUserId} onValueChange={setGrantUserId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Vyberte uživatele" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.fullName ?? u.email} ({u.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={grantMuniId} onValueChange={setGrantMuniId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Vyberte obec" />
                    </SelectTrigger>
                    <SelectContent>
                      {municipalities.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={granting} className="w-full h-11">
                    Přidat roli
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {users.map((u) => (
                <Card key={u.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                          {(u.fullName ?? u.email).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-bold truncate">{u.fullName ?? "Bez profilu"}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                    </div>
                    {u.communityRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {u.communityRoles.map((r) => (
                          <Badge key={r.userRoleId} variant="secondary" className="gap-1 pr-1">
                            {ROLE_LABEL[r.role] ?? r.role} · {r.municipalityName}
                            <button
                              type="button"
                              onClick={() =>
                                u.communityRoles.length === 1 ? setLastRoleRevoke(u) : handleRevoke(r.userRoleId)
                              }
                              className="ml-0.5 hover:text-destructive"
                              aria-label="Odebrat roli"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <AlertDialog
              open={lastRoleRevoke !== null}
              onOpenChange={(open) => !open && !deletingLastRole && setLastRoleRevoke(null)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Odebrat poslední roli „{lastRoleRevoke?.fullName ?? lastRoleRevoke?.email}“?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Tohle je jediná role, kterou uživatel má. Bez role by účet nepatřil do žádné obce, takže se
                    spolu s rolí smaže i on — včetně profilu, přihlášek na akce a oznámení. Nejde to vrátit zpět.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deletingLastRole}>Zrušit</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      handleDeleteWithLastRole();
                    }}
                    disabled={deletingLastRole}
                    className={buttonVariants({ variant: "destructive" })}
                  >
                    {deletingLastRole ? "Mažu…" : "Odebrat a smazat účet"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          {/* --- Žádosti (napříč obcemi) ------------------------------------------------ */}
          <TabsContent value="requests" className="pt-4 space-y-5">
            {orgRequests.length === 0 && volRequests.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Žádné čekající žádosti.</p>
            ) : (
              <>
                {orgRequests.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <UserPlus className="h-4 w-4 text-primary" />
                      <p className="font-bold text-sm">Žádosti o roli organizátora</p>
                    </div>
                    {orgRequests.map((r) => (
                      <Card key={r.id}>
                        <CardContent className="p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{r.full_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {r.municipality_name} · {new Date(r.created_at).toLocaleDateString("cs-CZ")}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-success border-success/40"
                            disabled={requestBusyId === r.id}
                            onClick={() => handleOrganizerRequestDecision(r.id, true)}
                          >
                            <Check className="h-4 w-4" /> Schválit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-destructive border-destructive/40"
                            disabled={requestBusyId === r.id}
                            onClick={() => handleOrganizerRequestDecision(r.id, false)}
                          >
                            <X className="h-4 w-4" /> Zamítnout
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {volRequests.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-1">
                      <HandHeart className="h-4 w-4 text-primary" />
                      <p className="font-bold text-sm">Žádosti o příznak Dobrovolnictví</p>
                    </div>
                    {volRequests.map((r) => (
                      <Card key={r.id}>
                        <CardContent className="p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{r.event_title}</p>
                            <p className="text-xs text-muted-foreground">
                              {r.municipality_name} · {r.requested_by_name} · {new Date(r.created_at).toLocaleDateString("cs-CZ")}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-success border-success/40"
                            disabled={requestBusyId === r.id}
                            onClick={() => handleVolunteerRequestDecision(r.id, true)}
                          >
                            <Check className="h-4 w-4" /> Schválit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-destructive border-destructive/40"
                            disabled={requestBusyId === r.id}
                            onClick={() => handleVolunteerRequestDecision(r.id, false)}
                          >
                            <X className="h-4 w-4" /> Zamítnout
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default function SuperAdminPage() {
  return (
    <RequireAuth>
      <RequireRole role="superadmin">
        <SuperAdminContent />
      </RequireRole>
    </RequireAuth>
  );
}
