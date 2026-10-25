'use client'

import { useCallback, useEffect, useState } from 'react'
import { Map as MapIcon, Pencil, Plus, Star } from 'lucide-react'
import { toast } from 'sonner'

import {
  createMicroregion,
  deleteMicroregion,
  listMicroregions,
  updateMicroregion,
  type MicroregionRow,
  type MunicipalityRow,
} from '@/integrations/payload/superadmin-queries'
import { PayloadApiError } from '@/integrations/payload/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loading } from '@/components/Loading'

const errorText = (error: unknown, fallback: string) =>
  error instanceof PayloadApiError && error.status < 500 ? error.message : fallback

type Draft = { id: string | null; name: string; mainId: string; memberIds: string[] }

/**
 * Mikroregiony (lib/microregions): obce that share one view — each other's events, volunteers and
 * co-organizing. 1–N obce each, an obec in one region at most, one of them the main obec. Kept by the
 * platform admin; deleting a region only lets its obce stand alone again.
 */
export function MicroregionsTab({ municipalities }: { municipalities: MunicipalityRow[] }) {
  const [regions, setRegions] = useState<MicroregionRow[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setRegions(await listMicroregions())
    } catch (error) {
      toast.error(errorText(error, 'Mikroregiony se nepodařilo načíst.'))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!regions) return <Loading />

  const nameOf = new Map(municipalities.map((m) => [m.id, m.name]))
  /** Which region each obec is in — an obec is offered to one region only. */
  const regionOf = new Map<string, MicroregionRow>()
  for (const r of regions) for (const id of r.municipality_ids) regionOf.set(id, r)

  const toggleMember = (id: string, on: boolean) =>
    setDraft((d) => {
      if (!d) return d
      const memberIds = on ? [...d.memberIds, id] : d.memberIds.filter((m) => m !== id)
      const mainId = memberIds.includes(d.mainId) ? d.mainId : (memberIds[0] ?? '')
      return { ...d, memberIds, mainId }
    })

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) return toast.error('Zadejte název mikroregionu.')
    if (draft.memberIds.length === 0) return toast.error('Vyberte aspoň jednu obec.')
    setSaving(true)
    try {
      const input = {
        name: draft.name.trim(),
        mainMunicipalityId: draft.mainId,
        municipalityIds: draft.memberIds,
      }
      if (draft.id) await updateMicroregion(draft.id, input)
      else await createMicroregion(input)
      toast.success(draft.id ? 'Mikroregion upraven.' : 'Mikroregion založen.')
      setDraft(null)
      await load()
    } catch (error) {
      toast.error(errorText(error, 'Mikroregion se nepodařilo uložit.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-primary" aria-hidden />
            <p className="font-bold flex-1">Mikroregiony</p>
            <Button
              size="sm"
              className="gap-1"
              onClick={() => setDraft({ id: null, name: '', mainId: '', memberIds: [] })}
            >
              <Plus className="h-4 w-4" aria-hidden /> Nový mikroregion
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Obce v mikroregionu vidí navzájem své akce, jejich dobrovolníci pomáhají i v ostatních
            obcích regionu a obce i organizace mohou spolupořádat akce napříč regionem. Ostatní
            (zakládání akcí, role, správa obce) zůstává po obcích. Obec může být jen v jednom
            mikroregionu.
          </p>
        </CardContent>
      </Card>

      {regions.length === 0 && (
        <p className="text-sm text-muted-foreground">Zatím žádný mikroregion.</p>
      )}
      {regions.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <p className="font-bold flex-1">{r.name}</p>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Upravit mikroregion ${r.name}`}
                onClick={() =>
                  setDraft({
                    id: r.id,
                    name: r.name,
                    mainId: r.main_municipality_id ?? '',
                    memberIds: r.municipality_ids,
                  })
                }
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <ConfirmDeleteButton
                title={`Zrušit mikroregion ${r.name}?`}
                description="Obce zůstanou, jen už nebudou sdílet akce, dobrovolníky a spolupořadatelství. Spolupořadatelství, která už na akcích jsou, zůstanou."
                onConfirm={async () => {
                  await deleteMicroregion(r.id)
                  await load()
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.municipality_ids.map((id) => (
                <Badge
                  key={id}
                  variant={id === r.main_municipality_id ? 'default' : 'secondary'}
                  className="gap-1"
                >
                  {id === r.main_municipality_id && <Star className="h-3 w-3" aria-hidden />}
                  {nameOf.get(id) ?? `Obec ${id}`}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Upravit mikroregion' : 'Nový mikroregion'}</DialogTitle>
            <DialogDescription>
              Vyberte obce, které budou sdílet akce, dobrovolníky a spolupořadatelství.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="microregion-name">Název</Label>
                <Input
                  id="microregion-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  maxLength={120}
                  className="mt-1.5"
                />
              </div>
              <div className="space-y-2">
                <Label>Obce</Label>
                <ul className="max-h-64 overflow-y-auto divide-y divide-border rounded-md border border-border">
                  {municipalities.map((m) => {
                    const other = regionOf.get(m.id)
                    const taken = Boolean(other && other.id !== draft.id)
                    return (
                      <li key={m.id}>
                        <label
                          className={`flex items-center gap-2.5 px-3 py-2 text-sm ${taken ? 'opacity-50' : 'cursor-pointer'}`}
                        >
                          <Checkbox
                            checked={draft.memberIds.includes(m.id)}
                            disabled={taken}
                            onCheckedChange={(v) => toggleMember(m.id, v === true)}
                          />
                          <span className="flex-1">{m.name}</span>
                          {taken && (
                            <span className="text-xs text-muted-foreground">v „{other!.name}“</span>
                          )}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
              {draft.memberIds.length > 0 && (
                <div>
                  <Label>Hlavní obec</Label>
                  <Select
                    value={draft.mainId}
                    onValueChange={(mainId) => setDraft({ ...draft, mainId })}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Vyberte hlavní obec" />
                    </SelectTrigger>
                    <SelectContent>
                      {draft.memberIds.map((id) => (
                        <SelectItem key={id} value={id}>
                          {nameOf.get(id) ?? `Obec ${id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Zrušit
            </Button>
            <Button onClick={save} disabled={saving}>
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
