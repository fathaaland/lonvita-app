# Odebrání spolupořadatele místo smazání akce, rozhodnutí obce a vypršení pozvánek

Datum: 2026-10-04 · Stav: schváleno v chatu, čeká na kontrolu spec

## Cíl

1. Žádost o smazání akce (`event-deletion-requests`) dostane třetí odpověď **„Ponechat akci, žadatele odebrat“**: žadatel z akce odejde, akce pokračuje pod tím, kdo tuto možnost zvolil.
2. Když druhý organizátor odmítne smazání i odebrání žadatele, může žadatel **požádat obec**. Admin obce pak žadatele odebere (nebo žádost zamítne) i bez souhlasu druhého organizátora.
3. **Pozvánky ke spolupořádání vyprší po 24 h** (nejpozději začátkem akce). Kdo nepřijme včas, u akce není — ze 2 pozvaných přijme 1 ⇒ akci pořádá pořadatel + 1 spolupořadatel.

## Rozhodnutí

| Otázka | Rozhodnutí |
|---|---|
| Žádá hlavní pořadatel a druhý zvolí „ponechat“ | Akce **přejde na něj**: stane se `organizer`em, `organization` = jeho organizace, původní zakladatel odchází. Přebírá i práva jen pro zakladatele (dobrovolnictví, hodnocení). Už udělená hodnocení zůstávají. |
| Víc spolupořadatelů | První „ponechat“ žádost hned uzavře (smazání už stejně neprojde). Odchází jen žadatel, ostatní zůstávají. Nástupcem (když žádal pořadatel) je ten, kdo „ponechat“ zvolil. |
| Samostatný odchod spolupořadatele | **Zrušen.** Odejít jde jen přes žádost (souhlas druhého nebo rozhodnutí obce). Admin obce a admin platformy dál mohou odebírat přímo. |
| Pravomoc obce | Jen **„Odebrat žadatele“** nebo **„Zamítnout“**. Smazat akci admin obce umí už dnes jinou cestou. |
| Lhůta žádosti u obce | Do začátku akce. Pak `expired`. |
| Lhůta pozvánek | 24 h pro všechny včetně obce, nejpozději začátkem akce. Po vypršení lze pozvat znovu. |

Mimo rozsah: akce, kterých se účastní obec — organizátoři jsou z nich zamčení (`lockedEventIds`) a žádost o smazání u nich nevznikne, takže se jich nový průběh netýká.

## Přístup

Rozšířit existující kolekci `event-deletion-requests` (obrácení se na obec je pokračování téže žádosti) místo nové kolekce. Využijí se stávající access, notifikace i worker `sync-statuses`.

## Datový model

### `event-deletion-requests`

Nové hodnoty `status`:

| stav | význam |
|---|---|
| `pending`, `approved`, `rejected`, `expired` | beze změny |
| `requester-removed` | žadatel odebrán — dohodou, nebo rozhodnutím obce |
| `escalated` | žadatel po zamítnutí požádal obec, čeká na admina obce |
| `escalation-rejected` | obec zamítla, vše zůstává |

Nová pole:
- `escalatedAt` (date) — kdy žadatel požádal obec.
- `rejectedBy` (relationship → users) — kdo odmítl; při rozhodnutí obce je to nástupce, pokud odchází pořadatel. (`decidedBy` se při rozhodnutí obce přepíše na admina obce, proto zvlášť.)
- `successor` (relationship → users) — kdo akci převzal, když odcházel hlavní pořadatel.

`decidedBy` / `decidedAt` drží poslední (konečné) rozhodnutí.

`deriveExpiredStatus` (afterRead): `pending` po `expiresAt` → `expired` (beze změny); `escalated` po začátku akce → `expired`. Worker zapíše obojí.

### `co-organizing-requests`

- Nové pole `expiresAt` (date, required) = min(teď + 24 h, `event.dateTime`), počítá `prepareRequest`.
- Nový stav `expired`; afterRead hook ho odvodí pro `pending` po `expiresAt`, worker `sync-statuses` ho zapíše.
- Kontrola duplicit v `prepareRequest` ignoruje vypršelé pozvánky (`expiresAt > now`).
- `applyDecision` odmítne rozhodnutí o vypršelé pozvánce: 409 „Pozvánka už vypršela.“
- Konstanta `CO_ORGANIZING_INVITATION_HOURS = 24`.
- **Migrace:** existující `pending` řádky dostanou `expiresAt = createdAt + 24 h` (staré nevyřízené pozvánky po nasazení vyprší).

### `events`

Schéma beze změny. `guardCoOrganizedChanges`: organizátor, který není admin obce ani platformy, nesmí z `coOrganizers` odebrat **nikoho** (ani sebe), pokud zápis nemá `context.coOrganizerConsent`.

## API a průběh

### `removeOrganizerFromEvent(req, event, leavingUserId, successorUserId)`

Nová sdílená funkce v `src/collections/shared/`, volaná oběma rozhodovacími cestami uvnitř transakce:
- **odchází spolupořadatel** → jeho organizace(e) pryč z `coOrganizations` (`coOrganizers` dopočítá `resolveOrganizations`);
- **odchází hlavní pořadatel** → `organizer = successorUserId`; organizace nástupce se odebere z `coOrganizations`; `organization` dopočítá `resolveOrganizations` (větev `organizerChanged`).
- Zápis s `overrideAccess: true` a `context: { coOrganizerConsent: true }`.
- Nástupce musí být stále na akci; jinak 409.

### `POST /api/events/deletion-requests/:id/decide`

Tělo `{ decision: 'approve' | 'reject' | 'remove-requester' }` (nahrazuje `approve: boolean`).
- `approve`, `reject` — beze změny (u `reject` se uloží i `rejectedBy`).
- `remove-requester` — jen organizátor z `approvers`, který je stále na akci, a jen ve stavu `pending`. V jedné transakci: `removeOrganizerFromEvent(event, requester, successor = rozhodující)` a žádost → `requester-removed` (`successor` vyplněn, když žadatel byl pořadatel). Odpověď `{ status: 'requester-removed' }`.

### `POST /api/events/deletion-requests/:id/escalate`

Jen žadatel; jen stav `rejected`; jen před začátkem akce; žadatel je stále na akci. → `escalated`, `escalatedAt = now`. Odpověď `{ status: 'escalated' }`.

### `POST /api/events/deletion-requests/:id/municipality-decide`

Tělo `{ remove: boolean }`. Jen admin obce akce (nebo admin platformy); jen stav `escalated`; před začátkem akce.
- `remove: true` → `removeOrganizerFromEvent(event, requester, successor = rejectedBy)`, stav `requester-removed`. Když `rejectedBy` už na akci není a žadatel je pořadatel, nástupcem je první zbývající spolupořadatel; když žádný není, 409.
- `remove: false` → `escalation-rejected`.

## UI

- **`EventDeletionConsent`** (detail akce):
  - rozhodující organizátor: tlačítka „Nesouhlasím“, „Ponechat akci, žadatele odebrat“, „Souhlasím se smazáním“; poslední dvě s potvrzovacím dialogem. Při žádosti pořadatele dialog říká „Akce přejde na vás, budete jejím hlavním pořadatelem.“
  - žadatel po zamítnutí (před začátkem akce): „Požádat obec o zrušení spolupořadatelství“; potom „Čeká na rozhodnutí obce“ / výsledek.
  - `getOpenEventDeletionRequest` vrací i poslední `rejected` a `escalated` žádost.
- **`RequestsTable`** (admin obce → Žádosti): sekce „Žádosti o zrušení spolupořadatelství“ — akce, žadatel, kdo odmítl, tlačítka „Odebrat žadatele“ (s dialogem) / „Zamítnout“.
- **`EventForm` / `CoOrganizerPicker`**: organizátor bez role admina obce nemůže odebrat žádnou uloženou organizaci; nápověda „Odejít z akce jde jen přes žádost o smazání.“
- **Pozvánky** (`CoOrganizingInvitations`, `CoOrganizingRequestCard`, čekající v `EventForm`): „platí do …“; vypršelé se mezi čekajícími neukazují.

## Notifikace

| Událost | Komu | Kanál |
|---|---|---|
| Žadatel odebrán dohodou | žadatel, tým; nástupce zvlášť „Akci teď vedete vy“ | app (+ e-mail žadateli) |
| Žadatel požádal obec | admini obce (e-mail), organizátor, který odmítl | app + e-mail |
| Obec rozhodla | žadatel a celý tým | app (+ e-mail žadateli) |
| Pozvánka vypršela | nikdo | — |

Audit log: `event-deletion-requests.requester-removed`, `event-deletion-requests.escalate`, `event-deletion-requests.municipality-remove`, `event-deletion-requests.municipality-reject`.

## Testy (integrační)

`tests/int/event-deletion-requests.int.spec.ts`:
- spolupořadatel žádá → druhý `remove-requester` → žadatel pryč, akce existuje;
- pořadatel žádá → spolupořadatel `remove-requester` → změnil se `organizer` i `organization`, nástupce není v `coOrganizations`, smí přepnout `isVolunteering`;
- 3 organizátoři → první „ponechat“ uzavře žádost, třetí zůstává;
- escalate: jen žadatel, jen po `rejected`, jen před začátkem; obec `remove: true` / `false`; organizátor bez role admina obce nesmí rozhodnout;
- organizátor nemůže PATCHem odebrat sám sebe; admin obce ano.

`tests/int/co-organizing-invitations.int.spec.ts`:
- `expiresAt` = min(+24 h, začátek akce);
- vypršelou pozvánku nelze přijmout (409); čte se jako `expired`;
- po vypršení lze pozvat znovu;
- 2 pozvánky, přijme 1, druhá vyprší → akce má pořadatele + 1 spolupořadatele.

`tests/int/status-sync.int.spec.ts`: worker označí vypršelé pozvánky a eskalace po začátku akce.
