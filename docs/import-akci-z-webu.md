# Import akcí z webů obcí a organizací — návrh

Stav: první verze implementovaná (2026-10-20) — viz „Implementace“ na konci. Synchronizace převzatých
akcí, automatické zveřejňování a příchozí e-mail zatím ne.

## Proč

Obce i organizátoři se nejčastěji ptají, jestli Lonvita umí převzít akce z kalendáře, který už mají
na webu. Zadávat každou akci znovu ručně je pro ně bariéra č. 1. Napojení přes API nedává smysl —
weby obcí žádné nemají. Cílem je, aby platforma akce z existujících webů převzala automaticky.

## Co jsme zjistili na skutečných webech

Vzorek 4 obcí ze seedu (malý, ale obrázek je jasný):

| Obec | Kde má akce | Strojově čitelná data (iCal, RSS, schema.org) |
|---|---|---|
| Nové Město na Moravě | samostatný WordPress `akce.nmnm.cz` | žádná, jen HTML |
| Blansko | vlastní CMS, přehledné HTML | žádná; místo konání je až na detailu akce |
| Žďár nad Sázavou | RSS „kalendář akcí“ existuje, ale je prázdné; akce jsou na `akce.zdarns.cz` | RSS nepoužitelné |
| Hamry nad Sázavou | stránka ve WordPressu | žádná |

Každý web je jiný. Vlastní kód pro každý web by se při tisících obcí nedal udržet. Škáluje jen
jeden obecný postup: stáhnout stránku a nechat AI vytáhnout akce do pevné struktury. Když web
nabízí iCal, RSS nebo schema.org, použijí se jako levnější zkratka bez AI.

## Z jakých zdrojů to půjde

| Typ zdroje | Půjde? | Jak | Spolehlivost |
|---|---|---|---|
| iCal / .ics (veřejný Google Kalendář, Outlook, kalendářové pluginy WordPressu) | ano | přímé načtení, bez AI | téměř 100 % |
| schema.org Event ve stránce (vstupenkové portály, některé CMS) | ano | přímé načtení, bez AI | velmi vysoká |
| RSS kalendáře akcí | ano | načtení, AI doplní datum a místo z textu | vysoká |
| Běžný web obce/podniku, program přímo v HTML | ano | stažení stránky a AI extrakce, u chybějícího místa i detail akce | vysoká (ověří test) |
| Vložený Google Kalendář (iframe) | ano | z iframe se vyčte ID kalendáře a převede se na iCal odkaz | téměř 100 % |
| Web, který akce dotahuje JavaScriptem | částečně | přímé čtení dat, která si stránka stahuje; jinak prohlížeč na serveru ve workeru | dobrá, ale dražší |
| Program jen v PDF (zpravodaj, program kulturáku) | částečně | AI přečte PDF | střední, vždy se schvaluje |
| Program jen jako obrázek / plakát | částečně | AI přečte obrázek | střední, vždy se schvaluje |

Podmínky, aby to u HTML webu šlo:

1. akce jsou na webu jako text (na struktuře stránky nezáleží);
2. stránka je veřejná — bez přihlášení, captchy či silné ochrany proti robotům a robots.txt
   stahování nezakazuje;
3. akce mají URL, které jde pravidelně procházet (stránkování po měsících worker projde);
4. údaje na webu skutečně jsou — AI nevymyslí datum ani místo, které chybí.

Nejslabší článek je místo konání („sokolovna“, „náměstí“). Geokódování v okolí obce ho často
najde, ale ne vždy — proto je výchozí režim schvalování adminem.

## Co nepůjde

| Zdroj | Proč |
|---|---|
| Facebook, Instagram | Vyžadují přihlášení, podmínky stahování zakazují, API cizí události nevydá. |
| Web za přihlášením, captchou, silnou ochranou proti robotům, se zákazem v robots.txt | Neobcházíme. Řeší se domluvou s provozovatelem (export, iCal odkaz). |
| Vágní text bez data („v sobotu odpoledne u hasičárny“) | Údaje chybí — vznikne kandidát s upozorněním, admin je doplní. |

Pravidelné akce („každé první úterý v měsíci“) AI přečte, ale Lonvita opakování nemá — rozepíší
se na jednotlivé akce na pár měsíců dopředu.

## Vstupy (adaptéry)

Jádrem je jeden společný převodník: AI vytáhne akce z jakéhokoli vstupu do stejné struktury a
ty jdou do stejné fronty ke schválení. Napojí se na něj:

1. **Odkaz na web** — automatické pravidelné stahování (hlavní cesta).
2. **Nahrát soubor** — PDF zpravodaje nebo fotka plakátu. Pokryje malé obce, které program na webu
   nemají, jen ve zpravodaji.
3. **Vložit text** — admin zkopíruje program odkudkoli (e-mail, ručně z Facebooku) a vloží ho.
4. **Příchozí e-mail** (později, volitelně) — program poslaný na adresu typu `akce-obec@…` se
   sám zpracuje. Ověřit, jestli to umí náš e-mailový poskytovatel.

Služby typu „web → RSS“ (RSS.app, FetchRSS) nedoporučujeme — problém jen přesunou k někomu
dalšímu, platí se za ně a s nečitelnými weby si neporadí.

Pro spolky, které žijí jen na Facebooku, platí opačný směr: akci založí v Lonvitě a sdílí ji na
Facebook (návod už máme — `FacebookEventGuide`).

## Jak to vypadá pro obec

1. Admin obce v Přehledu obce vloží odkaz na kalendář (svůj web, kulturní dům, Google Kalendář).
   Tlačítkem „Vyzkoušet“ hned uvidí, co by se převzalo.
2. Worker zdroj každých pár hodin projde. Nové a změněné akce zařadí do fronty „Import akcí“.
3. Admin akce schválí (i hromadně), upraví ve stejném formuláři jako běžnou akci, nebo zamítne.
4. Až se zdroj osvědčí, může ho přepnout na „publikovat automaticky“.

## Technický návrh

### Nové kolekce

- **`event-sources`** — obec, URL, typ (zjistí se sám: iCal / RSS / schema.org / HTML), kdo zdroj
  založil, zapnuto/vypnuto, poslední běh a chyba, režim (kontrola / automaticky).
- **`event-import-candidates`** — vytažená data akce, odkaz na zdroj, unikátní klíč (UID z iCalu
  nebo URL detailu), stav (nová / schválená / zamítnutá / změněná / zmizela), upozornění („místo
  nenalezeno“…) a odkaz na vzniklou akci.
- **`Events`** — nový odkaz na zdroj; detail akce ukáže „Převzato z webu obce“. Migrace je jen
  přidávací.

### Worker

- Nové joby v `src/lib/queue/contracts.ts`: cron `scrape-sources`, který pro každý zdroj spustí
  `scrape-source`.
- Využije existující `fetchNominatim` (geokódování), `consumeRateLimit` (šetrné tempo vůči webům)
  a logger.
- Běží na Railway — žádné časové limity serverless funkcí.

### Proč fronta ke schválení, a ne rovnou akce

`Events` má přísná pravidla, která stažená data často nesplní:

- kategorie je povinná;
- `lat`/`lng` jsou povinné a musí ležet v okruhu obce (`validateEventLocationRadius`);
- pořadatel musí mít v obci roli (`requireOrganizerRole`);
- začátek nesmí být v minulosti;
- `endDateTime` jde nastavit jen u vícedenních akcí (`validateEventDates`) — konec ve stejný den
  („18:00–20:00“) půjde jen do popisu.

Kandidát mezery unese, admin je doplní. Schválení založí akci přes Local API s `user: admin` a
`overrideAccess: false` — projde všemi stávajícími kontrolami a hooky, žádná nová cesta, kterou by
bylo potřeba zabezpečit.

### Výchozí nastavení importované akce

- Pořadatel = admin, který akci schválí. `resolveOrganizations` ji přiřadí organizaci obce, takže
  tvůrcem akce je obec.
- Kapacita `UNLIMITED_CAPACITY`, přihlašování `auto`. Taková akce nevede docházku (připomínka
  docházky ji už teď přeskakuje) a žádost o hodnocení přijde po skončení. Přihlášení funguje jako
  „půjdu“ a obec má data pro statistiky i u převzatých akcí.
- Místo přes Nominatim omezený na okolí obce. Nenajde-li se nebo leží mimo okruh, kandidát dostane
  upozornění a admin klikne místo do mapy.
- Fotky ve výchozím stavu nepřebíráme (autorská práva); výjimkou může být web samotné obce.

### Synchronizace změn

- Akce se na webu změní → upravíme ji v Lonvitě; stávající `notifyRegistrantsOnEdit` upozorní
  přihlášené.
- Admin akci v Lonvitě ručně upravil → nepřepisujeme, jen upozorníme na rozdíl.
- Akce z webu zmizí nebo je u ní „ZRUŠENO“ → nikdy nerušíme automaticky (zrušení je nevratné a
  odchází SMS). Admin dostane upozornění a rozhodne.
- Duplicity hlídáme i vůči ručně založeným akcím: stejný den a podobný název.

### AI

Malý levný model se strukturovaným výstupem. Do AI jdou jen stránky, které se od minula změnily
(otisk obsahu), takže náklady zůstanou nízké — skutečné číslo změří test. API klíč bude volitelná
proměnná v `src/lib/env.ts`; bez něj fungují jen zdroje s iCal, RSS nebo schema.org.

## Rizika

- **Právní stránka.** Web obce patří zákazníkovi — stačí souhlas ve smlouvě. Cizí weby (kulturní
  dům, spolek) jen s jejich souhlasem. Přebíráme fakta (co, kdy, kde) a odkaz na zdroj, ne celé
  texty a fotky. Respektujeme robots.txt.
- **Chyby AI.** Výchozí režim je schvalování; automatické zveřejňování jen u ověřených zdrojů.
- **Weby na JavaScriptu** by potřebovaly prohlížeč na serveru — přidáme jen, pokud bude častý.

## Doplněk: opačný směr

Lonvita by dávala iCal feed nebo widget, který si obec vloží na svůj web. Obec pak akce zadá jen
jednou v Lonvitě a web je zobrazí sám — dvojí zadávání zmizí natrvalo. Import je most pro začátek;
feed/widget je pár dní práce.

## Postup

1. **Test, 2–3 dny** — na 10–20 webech obcí, které se na import ptají: u kolika to funguje, jak
   přesně se vytáhne název, datum a místo, kolik se geokóduje, kolik to stojí. Podle toho
   rozhodnout, jestli pokračovat.
2. **První verze, ~1,5–2 týdny (hrubý odhad)** — zdroje, import s ručním schválením, iCal a AI
   extrakce, nahrání souboru a vložení textu.
3. **Potom** — synchronizace změn, upozornění na zmizelé akce, automatické zveřejňování,
   případně příchozí e-mail.

## Otevřené otázky

1. Které weby vyzkoušet v testu?
2. Akce spolků z webu obce: vést jako akce obce, nebo má obec spolek pozvat ke spolupořádání?
3. Je automatické zveřejňování bez kontroly vůbec žádoucí?

## Implementace (v1)

| Část | Kde |
|---|---|
| Bezpečné stahování (jen veřejný internet, kontrola adresy při připojení, přesměrování, limity, robots.txt, kódování) | `src/lib/import/fetch.ts` |
| iCal (časové zóny, celodenní, opakované akce) | `src/lib/import/ical.ts` |
| schema.org Event, vložený Google Kalendář, HTML → text s odkazy, RSS/Atom | `src/lib/import/html.ts` |
| AI extrakce (Claude, strukturovaný výstup; text, PDF, obrázek; doplnění z detailu akce) | `src/lib/import/ai.ts` |
| Pipeline: čtení zdroje, deduplikace, geokódování v okruhu obce, varování, uložení kandidátů | `src/lib/import/pipeline.ts`, `geocode.ts`, `normalize.ts`, `time.ts` |
| Převzetí / zamítnutí (akce se zakládá přes kolekci Events jménem admina obce) | `src/lib/import/approve.ts` |
| Kolekce | `EventSources` (`event-sources`), `EventImportCandidates` (`event-import-candidates`), pole `Events.importedFrom` |
| Worker | cron `scan-event-sources` (každých 6 h), job `import-events`; retence kandidátů (`past-import-candidates`) |
| API | `POST /api/import/sources/:id/run`, `/api/import/text`, `/api/import/file`, `/api/import/candidates/:id/approve`, `/api/import/candidates/:id/reject`, `/api/import/candidates/approve` |
| UI | Přehled obce → „Import akcí“ (`ImportPanel`), stránka `/import/[id]` (doplnit a převzít ve formuláři akce), „Převzato z …“ na detailu akce |
| Testy | `tests/int/event-import.int.spec.ts` |

Rozhodnutí v1:
- Převzatá akce se zakládá za obec (pořadatel = admin, který ji převzal), s neomezenou kapacitou a přihlašováním
  bez schvalování; v „Upravit a převzít“ jde cokoli změnit.
- Každé varování (chybí místo/čas/kategorie, mimo okruh, možná duplicita, zrušená u zdroje) brání převzetí bez
  otevření formuláře.
- Kandidát se pozná podle zdrojového ID / adresy detailu / názvu + data, a navíc podle podobného názvu ve stejný den;
  rozhodnutý se už nevrací. Čekající se při dalším průchodu aktualizuje podle zdroje.
- Nezměněná stránka se do AI znovu neposílá (otisk obsahu na zdroji).
- Limity: 10 zdrojů na obec, 20 AI importů za hodinu na admina, soubor do 4 MB, text do 50 000 znaků.

Proměnné prostředí (worker): `ANTHROPIC_API_KEY` (bez něj jen iCal a schema.org), volitelně `IMPORT_AI_MODEL`
(výchozí `claude-haiku-5-5`).

## Implementace (v2, rozpracováno od 2026-10-24)

Rozhodnutí: import je v **paušálu**, spotřeba AI se eviduje **na obec**, zdroje se kontrolují **denně i
týdně**, import vytváří **jen návrhy** (nic se nezveřejní ani nezruší samo). Import je **jen pro obec** —
zdroje přidává a akce přebírá admin obce, organizátoři vlastní zdroje nemají (rozhodnuto 2026-10-24).

| Část | Kde |
|---|---|
| Účtování AI — převzato 1:1 z hbai-app (tenant → obec): kniha `usage-events` (jen zápis, cena v okamžiku volání, i neúspěšná volání), ceník, `recordUsageEvent`, SQL agregace | `src/collections/UsageEvents.ts`, `src/lib/providers/usage-pricing.ts`, `src/lib/usage/record-usage.ts`, `src/lib/usage/dashboard-aggregation.ts` |
| Usage & Cost Dashboard v Payload adminu (jen správce platformy) | `/admin/usage-dashboard`, `GET /api/admin/usage-dashboard`, `src/components/admin/usage-dashboard-*` |
| Měření importu a fair-use limit obce (`IMPORT_LIMITS.aiMonthlyBudgetUsd`; po vyčerpání jen iCal a schema.org) | `src/lib/import/usage.ts` (`meterAi`, `isOverAiBudget`) |
| Historie běhů (spouštěč, výsledek, chyba, počty, tokeny, cena); retence 180 dní | `ImportRuns` (`import-runs`), krok `old-import-runs` v data-retention |
| Rozvrh: každou půlnoc kontrola (AI jen při změně řádků s datem — `eventLinesOf`), noc na pondělí plný průchod; „Zkontrolovat teď“ = plný průchod, max. 5× denně na zdroj | `scan-event-sources`, `SourceTrigger` v `contracts.ts` |
| Posuvné okno: ze zdroje se při každém průchodu berou jen akce na 4 týdny dopředu (`IMPORT_LIMITS.sourceWindowDays`). AI dostane hranici a pozdější akce vůbec nevypisuje (šetří výstupní tokeny), detailní stránky se otevírají jen v okně, iCal se ořízne stejně. Kalendář na půl roku tak přibývá po týdnech (pondělní plný průchod přidá týden, který do okna vjel) a akce se objeví zhruba 3–4 týdny předem. Jednorázový import (text, soubor) bere celý rok (`horizonDays`) | `contracts.ts`, `ai.ts` (`AiContext.until`), `ical.ts`, `storeCandidates({ until })`, `import-events.processor.ts` |
| Jen admin obce: zdroje, návrhy i běhy vidí a spravuje admin obce (a správce platformy); souhlas provozovatele webu při přidání zdroje | `access/import.ts`, `ownerConsentAt` |
| Dřívější zdroje organizátorů: sloupec `organization` už nic nezapisuje, záznamy s ním nevidí žádný admin obce a worker je přeskakuje; smaže je následná migrace | `EventSources/EventImportCandidates/ImportRuns.organization` |

Zbývá: migrace, která odstraní sloupce `organization` (až bude v produkci kód, který je nepoužívá).
