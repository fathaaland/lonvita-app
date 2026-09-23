"use client";

import { useState } from "react";
import {
  createOrganizationAsSuperAdmin,
  updateOrganizationAsSuperAdmin,
  deleteOrganizationAsSuperAdmin,
  MunicipalityRow,
  PlatformUserRow,
  SuperAdminOrganizationRow,
} from "@/integrations/payload/superadmin-queries";
import { PayloadApiError } from "@/integrations/payload/client";
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
  ORGANIZATION_TYPES,
  isMunicipalityOrganization,
  organizationTypeLabel,
  type OrganizationType,
} from "@/lib/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Store, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ALL_MUNICIPALITIES = "__all__";

const chipClass = (active: boolean) =>
  cn(
    "px-3 py-2 rounded-full text-sm font-semibold border-[1.5px] transition-colors",
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "bg-card text-foreground border-border hover:border-brand-purple",
  );

interface Props {
  organizations: SuperAdminOrganizationRow[];
  municipalities: MunicipalityRow[];
  users: PlatformUserRow[];
  /** Reloads the panel — creating or deleting an organization grants/revokes its owner's organizer role too. */
  onChanged: () => void;
}

export function TypeChips({ value, onChange }: { value: OrganizationType; onChange: (type: OrganizationType) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {ORGANIZATION_TYPES.map((t) => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)} className={chipClass(value === t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Superadmin "Organizace" tab — every obec's organizations (Organizations.ts). Owner and obec are
 * set once at creation; creating one makes its owner an organizer there, deleting it ends that.
 * The obec's own organization comes and goes with the obec — it can only be renamed here. */
export function OrganizationsTab({ organizations, municipalities, users, onChanged }: Props) {
  const [filterMuniId, setFilterMuniId] = useState(ALL_MUNICIPALITIES);
  const [query, setQuery] = useState("");

  const [newMuniId, setNewMuniId] = useState("");
  const [newOwnerId, setNewOwnerId] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<OrganizationType>("business");
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<SuperAdminOrganizationRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<OrganizationType>("individual");
  const [saving, setSaving] = useState(false);

  const userById = new Map(users.map((u) => [u.id, u]));
  const muniNameById = new Map(municipalities.map((m) => [m.id, m.name]));
  const ownerLabel = (ownerId: string | null) => {
    if (ownerId === null) return "Obec";
    const owner = userById.get(ownerId);
    return owner ? (owner.fullName ?? owner.email) : "Neznámý uživatel";
  };

  // Only people who belong to the obec (registered under it, or holding a role there). One
  // organization per person per obec, and never the obec's own admin — they run events as the obec.
  const ownerCandidates = newMuniId
    ? users.filter(
        (u) =>
          (u.homeMunicipalityId === newMuniId || u.communityRoles.some((r) => r.municipalityId === newMuniId)) &&
          !organizations.some((o) => o.ownerId === u.id && o.municipalityId === newMuniId) &&
          !u.communityRoles.some((r) => r.role === "municipality_admin" && r.municipalityId === newMuniId),
      )
    : [];

  const needle = query.trim().toLocaleLowerCase("cs");
  const visible = organizations.filter(
    (o) =>
      (filterMuniId === ALL_MUNICIPALITIES || o.municipalityId === filterMuniId) &&
      (!needle ||
        o.name.toLocaleLowerCase("cs").includes(needle) ||
        ownerLabel(o.ownerId).toLocaleLowerCase("cs").includes(needle)),
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMuniId || !newOwnerId) {
      toast.error("Vyberte obec a vlastníka.");
      return;
    }
    if (newName.trim().length < ORGANIZATION_NAME_MIN_LENGTH) {
      toast.error(`Název musí mít aspoň ${ORGANIZATION_NAME_MIN_LENGTH} znaky.`);
      return;
    }
    setCreating(true);
    try {
      await createOrganizationAsSuperAdmin({
        name: newName.trim(),
        type: newType,
        ownerId: newOwnerId,
        municipalityId: newMuniId,
      });
      toast.success("Organizace vytvořena.");
      setNewOwnerId("");
      setNewName("");
      setNewType("business");
      onChanged();
    } catch (error) {
      toast.error(error instanceof PayloadApiError ? error.message : "Nepodařilo se vytvořit organizaci.");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (o: SuperAdminOrganizationRow) => {
    setEditing(o);
    setEditName(o.name);
    if (!isMunicipalityOrganization(o)) setEditType(o.type as OrganizationType);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (editName.trim().length < ORGANIZATION_NAME_MIN_LENGTH) {
      toast.error(`Název musí mít aspoň ${ORGANIZATION_NAME_MIN_LENGTH} znaky.`);
      return;
    }
    setSaving(true);
    try {
      await updateOrganizationAsSuperAdmin(
        editing.id,
        isMunicipalityOrganization(editing) ? { name: editName.trim() } : { name: editName.trim(), type: editType },
      );
      toast.success("Organizace uložena.");
      setEditing(null);
      onChanged();
    } catch (error) {
      toast.error(error instanceof PayloadApiError ? error.message : "Nepodařilo se uložit organizaci.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteOrganizationAsSuperAdmin(id);
    toast.success("Organizace smazána.");
    onChanged();
  };

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="eyebrow">
            <Store className="h-3 w-3" /> Nová organizace
          </div>
          <form onSubmit={handleCreate} className="space-y-3">
            <Select
              value={newMuniId}
              onValueChange={(v) => {
                setNewMuniId(v);
                setNewOwnerId("");
              }}
            >
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
            <Select value={newOwnerId} onValueChange={setNewOwnerId} disabled={!newMuniId}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Vyberte vlastníka" />
              </SelectTrigger>
              <SelectContent>
                {ownerCandidates.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName ?? u.email} ({u.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div>
              <Label>Typ</Label>
              <TypeChips value={newType} onChange={setNewType} />
            </div>
            <div>
              <Label htmlFor="no-name">Název *</Label>
              <Input
                id="no-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                placeholder="Např. Kavárna NMNM"
                className="h-11 mt-1.5"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Vlastník dostane v obci roli „Organizátor“, pokud ji ještě nemá. Vlastníka ani obec už potom změnit nejde.
            </p>
            <Button type="submit" disabled={creating} className="w-full h-11">
              Vytvořit organizaci
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Select value={filterMuniId} onValueChange={setFilterMuniId}>
          <SelectTrigger className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_MUNICIPALITIES}>Všechny obce</SelectItem>
            {municipalities.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hledat podle názvu nebo vlastníka…"
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        {visible.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Žádné organizace.</p>}
        {visible.map((o) => (
          <Card key={o.id}>
            <CardContent className="p-4 flex items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate">{o.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {ownerLabel(o.ownerId)} · {muniNameById.get(o.municipalityId) ?? "Neznámá obec"}
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {organizationTypeLabel(o.type)}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={() => startEdit(o)}
                aria-label="Upravit organizaci"
                title="Upravit organizaci"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              {!isMunicipalityOrganization(o) && (
                <ConfirmDeleteButton
                  title={`Smazat organizaci „${o.name}“?`}
                  description="Vlastník tím v obci přestane být pořadatelem (přijde o roli „Organizátor“) a organizace zmizí ze spolupořadatelů všech akcí. Akce, které sama pořádá, je potřeba nejdřív zrušit. Nejde to vrátit zpět."
                  onConfirm={() => handleDelete(o.id)}
                  errorMessage="Organizaci se nepodařilo smazat."
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && !saving && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upravit organizaci</DialogTitle>
            <DialogDescription>
              {editing && isMunicipalityOrganization(editing)
                ? `Organizace obce ${muniNameById.get(editing.municipalityId) ?? ""} — pod ní obec pořádá své akce. Změnit jde jen název.`
                : editing &&
                  `${ownerLabel(editing.ownerId)} · ${muniNameById.get(editing.municipalityId) ?? "Neznámá obec"} — vlastníka ani obec měnit nejde.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            {editing && !isMunicipalityOrganization(editing) && (
              <div>
                <Label>Typ</Label>
                <TypeChips value={editType} onChange={setEditType} />
              </div>
            )}
            <div>
              <Label htmlFor="eo-name">Název *</Label>
              <Input
                id="eo-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                className="h-11 mt-1.5"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={saving}>
                Zrušit
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
