"use client";

import { useEffect, useState } from "react";
import {
  listMunicipalitiesForSuperAdmin,
  createMunicipality,
  updateMunicipality,
  deleteMunicipality,
  createUserAsSuperAdmin,
  listAllUsersForSuperAdmin,
  updateUserPlatformRole,
  deleteUserAsSuperAdmin,
  listAllEventsForSuperAdmin,
  grantCommunityRole,
  revokeCommunityRole,
  MunicipalityRow,
  PlatformUserRow,
  SuperAdminEventRow,
} from "@/integrations/payload/superadmin-queries";
import { getEventCategories, createEvent, listMunicipalities } from "@/integrations/payload/queries";
import type { MunicipalityMapPoint } from "@/components/map/MunicipalitiesMap";
import { PayloadApiError } from "@/integrations/payload/client";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { CancelEventButton } from "@/components/CancelEventButton";
import { Button } from "@/components/ui/button";
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
import { Building2, Users as UsersIcon, CalendarPlus, Shield, X, UserPlus, LogOut, MapPin, Pencil } from "lucide-react";
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
  prescriber: "Prescriber",
};

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
  const [loading, setLoading] = useState(true);

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

  // Akce tab — new event form
  const [evTitle, setEvTitle] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evTime, setEvTime] = useState("");
  const [evLocation, setEvLocation] = useState<PickedLocation | null>(null);
  const [evCapacity, setEvCapacity] = useState("10");
  const [evCategoryId, setEvCategoryId] = useState("");
  const [evMuniId, setEvMuniId] = useState("");
  const [evOrganizerId, setEvOrganizerId] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Role tab — grant form
  const [grantUserId, setGrantUserId] = useState("");
  const [grantMuniId, setGrantMuniId] = useState("");
  const [granting, setGranting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [munis, points, us, cats, evs] = await Promise.all([
      listMunicipalitiesForSuperAdmin(),
      listMunicipalities(),
      listAllUsersForSuperAdmin(),
      getEventCategories(),
      listAllEventsForSuperAdmin(),
    ]);
    setMunicipalities(munis);
    setMapPoints(points);
    setUsers(us);
    setCategories(cats);
    setEvents(evs);
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

  const handleToggleUserRole = async (u: PlatformUserRow) => {
    const next = u.platformRole === "admin" ? "user" : "admin";
    try {
      await updateUserPlatformRole(u.id, next);
      toast.success(next === "admin" ? "Uživatel je teď platformní admin." : "Platformní admin práva odebrána.");
      load();
    } catch {
      toast.error("Nepodařilo se upravit roli uživatele.");
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

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evTitle.trim() || !evDescription.trim() || !evDate || !evTime || !evLocation) {
      toast.error("Vyplňte všechna pole a vyberte místo na mapě.");
      return;
    }
    if (!evCategoryId || !evMuniId || !evOrganizerId) {
      toast.error("Vyberte kategorii, obec a pořadatele.");
      return;
    }
    if (new Date(`${evDate}T${evTime}`).getTime() < Date.now()) {
      toast.error("Akce nemůže začínat v minulosti.");
      return;
    }
    setCreatingEvent(true);
    try {
      const dt = new Date(`${evDate}T${evTime}`);
      await createEvent({
        title: evTitle.trim(),
        description: evDescription.trim(),
        dateTimeIso: dt.toISOString(),
        locationText: evLocation.label,
        lat: evLocation.lat,
        lng: evLocation.lng,
        capacity: Number(evCapacity),
        organizerUserId: evOrganizerId,
        municipalityId: evMuniId,
        // Superadmin picks one category here for now — multi-select is on the organizer-facing
        // "vytvorit" form (brief §2); this internal ops form can catch up later.
        categoryIds: [evCategoryId],
      });
      toast.success("Akce vytvořena.");
      setEvTitle("");
      setEvDescription("");
      setEvDate("");
      setEvTime("");
      setEvLocation(null);
      setEvCapacity("10");
      setEvCategoryId("");
      setEvMuniId("");
      setEvOrganizerId("");
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError && error.status === 400 ? error.message : "Nepodařilo se vytvořit akci.",
      );
    } finally {
      setCreatingEvent(false);
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

  const logoutAction = (
    <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
      <LogOut className="h-4 w-4" />
      Odhlásit
    </Button>
  );

  if (loading) return <><PageHeader title="Superadmin" right={logoutAction} /><Loading /></>;

  const newUserMuniName = mapPoints.find((m) => m.id === newUserMuniId)?.name;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Superadmin" right={logoutAction} />
      {/* Wider on large screens so the municipality/location maps in these forms get room too. */}
      <div className="px-4 py-5 max-w-2xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full h-14 grid grid-cols-4">
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleToggleUserRole(u)}
                      aria-label={u.platformRole === "admin" ? "Odebrat superadmina" : "Udělat superadminem"}
                      title={u.platformRole === "admin" ? "Odebrat superadmina" : "Udělat superadminem"}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmDeleteButton
                      title={`Smazat uživatele „${u.fullName ?? u.email}“?`}
                      description="Smazání účtu nejde vrátit zpět."
                      onConfirm={() => handleDeleteUser(u.id)}
                      errorMessage="Uživatele se nepodařilo smazat."
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* --- Akce -------------------------------------------------------------------- */}
          <TabsContent value="events" className="pt-4 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="eyebrow">
                  <CalendarPlus className="h-3 w-3" /> Nová akce
                </div>
                <form onSubmit={handleCreateEvent} className="space-y-3">
                  <div>
                    <Label htmlFor="ev-title">Název akce *</Label>
                    <Input id="ev-title" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} className="h-11 mt-1.5" />
                  </div>
                  <Select value={evCategoryId} onValueChange={setEvCategoryId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Vyberte kategorii" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div>
                    <Label htmlFor="ev-desc">Popis *</Label>
                    <Textarea id="ev-desc" value={evDescription} onChange={(e) => setEvDescription(e.target.value)} className="mt-1.5" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="ev-date">Datum *</Label>
                      <Input id="ev-date" type="date" min={toDateInputValue()} value={evDate} onChange={(e) => setEvDate(e.target.value)} className="h-11 mt-1.5" />
                    </div>
                    <div>
                      <Label htmlFor="ev-time">Čas *</Label>
                      <Input id="ev-time" type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} className="h-11 mt-1.5" />
                    </div>
                  </div>
                  <div>
                    <Label>Místo konání *</Label>
                    <div className="mt-1.5">
                      <LocationPicker
                        value={evLocation}
                        onChange={setEvLocation}
                        initialCenter={CZECHIA_CENTER}
                        existingPoints={mapPoints}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="ev-cap">Kapacita *</Label>
                    <Input
                      id="ev-cap"
                      type="number"
                      min="1"
                      value={evCapacity}
                      onChange={(e) => setEvCapacity(e.target.value)}
                      className="h-11 mt-1.5"
                    />
                  </div>
                  <Select value={evMuniId} onValueChange={setEvMuniId}>
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
                  <Select value={evOrganizerId} onValueChange={setEvOrganizerId}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Vyberte pořadatele" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.fullName ?? u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={creatingEvent} className="w-full h-11">
                    Vytvořit akci
                  </Button>
                </form>
              </CardContent>
            </Card>

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
                            {r.role !== "participant" && (
                              <button
                                type="button"
                                onClick={() => handleRevoke(r.userRoleId)}
                                className="ml-0.5 hover:text-destructive"
                                aria-label="Odebrat roli"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
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
