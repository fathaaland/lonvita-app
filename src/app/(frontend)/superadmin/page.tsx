"use client";

import { useEffect, useState } from "react";
import {
  listMunicipalitiesForSuperAdmin,
  createMunicipality,
  createUserAsSuperAdmin,
  listAllUsersForSuperAdmin,
  grantCommunityRole,
  revokeCommunityRole,
  MunicipalityRow,
  PlatformUserRow,
} from "@/integrations/payload/superadmin-queries";
import { getEventCategories, createEvent } from "@/integrations/payload/queries";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth, RequireRole } from "@/components/RequireAuth";
import { PageHeader } from "@/components/PageHeader";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Building2, Users as UsersIcon, CalendarPlus, Shield, X, UserPlus, LogOut } from "lucide-react";
import { toast } from "sonner";
import type { CategoryRow } from "@/lib/analytics";

const ROLE_LABEL: Record<string, string> = {
  participant: "Účastník",
  municipality_admin: "Admin obce",
  prescriber: "Prescriber",
};

function SuperAdminContent() {
  const { signOut } = useAuth();
  const [tab, setTab] = useState("municipalities");
  const [municipalities, setMunicipalities] = useState<MunicipalityRow[]>([]);
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Obce tab — new municipality form
  const [muniName, setMuniName] = useState("");
  const [muniDescription, setMuniDescription] = useState("");
  const [creatingMuni, setCreatingMuni] = useState(false);

  // Uživatelé tab — new user form
  const [newFullName, setNewFullName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newUserMuniId, setNewUserMuniId] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);

  // Akce tab — new event form
  const [evTitle, setEvTitle] = useState("");
  const [evDescription, setEvDescription] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evTime, setEvTime] = useState("");
  const [evLocation, setEvLocation] = useState("");
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
    const [munis, us, cats] = await Promise.all([
      listMunicipalitiesForSuperAdmin(),
      listAllUsersForSuperAdmin(),
      getEventCategories(),
    ]);
    setMunicipalities(munis);
    setUsers(us);
    setCategories(cats);
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
    setCreatingMuni(true);
    try {
      await createMunicipality({
        name: muniName.trim(),
        description: muniDescription.trim() || undefined,
      });
      toast.success("Obec vytvořena.");
      setMuniName("");
      setMuniDescription("");
      load();
    } catch {
      toast.error("Nepodařilo se vytvořit obec.");
    } finally {
      setCreatingMuni(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim() || !newEmail.trim() || !newPassword || !newUserMuniId) {
      toast.error("Vyplňte všechna pole.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Heslo musí mít alespoň 8 znaků.");
      return;
    }
    setCreatingUser(true);
    try {
      await createUserAsSuperAdmin({
        email: newEmail.trim(),
        password: newPassword,
        fullName: newFullName.trim(),
        municipalityId: newUserMuniId,
      });
      toast.success("Uživatel vytvořen.");
      setNewFullName("");
      setNewEmail("");
      setNewPassword("");
      setNewUserMuniId("");
      load();
    } catch {
      toast.error("Nepodařilo se vytvořit uživatele — e-mail už možná existuje.");
    } finally {
      setCreatingUser(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evTitle.trim() || !evDescription.trim() || !evDate || !evTime || !evLocation.trim()) {
      toast.error("Vyplňte všechna pole.");
      return;
    }
    if (!evCategoryId || !evMuniId || !evOrganizerId) {
      toast.error("Vyberte kategorii, obec a pořadatele.");
      return;
    }
    setCreatingEvent(true);
    try {
      const dt = new Date(`${evDate}T${evTime}`);
      await createEvent({
        title: evTitle.trim(),
        description: evDescription.trim(),
        dateTimeIso: dt.toISOString(),
        locationText: evLocation.trim(),
        capacity: Number(evCapacity),
        organizerUserId: evOrganizerId,
        municipalityId: evMuniId,
        categoryId: evCategoryId,
      });
      toast.success("Akce vytvořena.");
      setEvTitle("");
      setEvDescription("");
      setEvDate("");
      setEvTime("");
      setEvLocation("");
      setEvCapacity("10");
      setEvCategoryId("");
      setEvMuniId("");
      setEvOrganizerId("");
    } catch {
      toast.error("Nepodařilo se vytvořit akci.");
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

  return (
    <div className="animate-fade-in">
      <PageHeader title="Superadmin" right={logoutAction} />
      <div className="px-4 py-5 max-w-2xl mx-auto space-y-4">
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
                  <Button type="submit" disabled={creatingMuni} className="w-full h-11">
                    Vytvořit obec
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {municipalities.map((m) => (
                <Card key={m.id}>
                  <CardContent className="p-4">
                    <p className="font-bold truncate">{m.name}</p>
                    {m.description && <p className="text-sm text-muted-foreground mt-0.5 truncate">{m.description}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* --- Uživatelé -------------------------------------------------------------- */}
          <TabsContent value="users" className="pt-4 space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="eyebrow">
                  <UserPlus className="h-3 w-3" /> Nový uživatel
                </div>
                <form onSubmit={handleCreateUser} className="space-y-3">
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
                  <Select value={newUserMuniId} onValueChange={setNewUserMuniId}>
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
                    <div className="min-w-0">
                      <p className="font-bold truncate">{u.fullName ?? "Bez profilu"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.email}
                        {u.homeMunicipalityName ? ` · ${u.homeMunicipalityName}` : ""}
                      </p>
                    </div>
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
                      <Input id="ev-date" type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} className="h-11 mt-1.5" />
                    </div>
                    <div>
                      <Label htmlFor="ev-time">Čas *</Label>
                      <Input id="ev-time" type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} className="h-11 mt-1.5" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="ev-loc">Místo *</Label>
                    <Input id="ev-loc" value={evLocation} onChange={(e) => setEvLocation(e.target.value)} className="h-11 mt-1.5" />
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
