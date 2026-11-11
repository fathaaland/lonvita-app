# Provoz: co zbývá udělat

Úkoly mimo kód, které jsou nutné, než Lonvita poběží spolehlivě v ostrém provozu.

## 🔴 Redis: web na Vercelu se k němu připojuje nešifrovaně přes internet

**Stav (11. 11. 2026):** Redis běží na Railway (projekt `worthy-youth`) vedle workeru. Worker se k němu
připojuje interní sítí (`redis.railway.internal`), ale web na Vercelu v té síti není, takže jde přes
veřejný TCP proxy Railway (`yamanote.proxy.rlwy.net:16346`). Ten TLS nemá — ověřeno: na obyčejný
`PING` odpověděl `NOAUTH`, tedy mluví nešifrovaně. Heslo k Redisu i obsah front (telefonní čísla
v SMS, texty e-mailů) tak putují internetem v čitelné podobě. Že Vercel jde právě touto cestou, je
odvozeno z toho, že `/api/health` z Vercelu hlásí Redis funkční; `REDIS_URL` ve Vercelu je skrytá
(Secret), schéma `redis://` vs `rediss://` se přečíst nedalo.

**Dopad:** kdo spojení zachytí, může číst a vkládat úlohy (poslat SMS nebo e-mail na účet obcí).
Před ostrým provozem s osobními údaji občanů je to nutné odstranit.

**Postup (nic z toho zatím neuděláno):**
1. Založit Redis se šifrováním (`rediss://`), nejlépe v EU (Frankfurt, Vercel běží ve `fra1`).
2. Spustit `sh scripts/set-redis-url.sh` — adresu zadáte skrytě; skript odmítne `redis://`, zkusí
   `PING`, zkontroluje `maxmemory-policy` a po potvrzení přepíše `REDIS_URL` na Vercelu (Production)
   i na Railway workeru (hodnota jde přes stdin, ne přes příkazový řádek). Je to jen napsané, ještě
   nikdy nespuštěné proti skutečnému Redisu.
3. Redeploy Vercelu i workeru; ověřit `/api/health` (`redis: true`, `worker: true`).
4. Smazat TCP proxy u Redisu na Railway (zavře veřejný nešifrovaný port). Starý Redis nechat pár dní
   jako zálohu, pak smazat.
5. Přepnout, když je fronta prázdná (`/api/health`: `emailsWaiting: 0`).

**Co jsme zjistili při výběru (11. 11. 2026):**
- **Změřená zátěž:** za 1,9 dne 1,16 milionu příkazů, tj. ~7 příkazů/s i bez uživatelů (údržba BullMQ
  a minutové plánované úlohy) → ~18 milionů příkazů měsíčně. Obsazená paměť jen 4 MB (214 klíčů).
- **Upstash Free (500 tisíc příkazů/měsíc) nestačí** — vyčerpal by se za asi 20 hodin. Upstash
  „Pay as You Go“ (0,20 $ za 100 tisíc příkazů) by vycházel na ~36 $/měsíc i bez uživatelů.
- **Upstash Fixed 250 MB: 10 $/měsíc**, neomezené příkazy, 10 000 příkazů/s, TLS vždy zapnuté
  (podle jejich dokumentace). Doporučená varianta pro ostrý provoz. Fixed 1 GB je 20 $/měsíc.
- **Redis Cloud Free:** 30 MB, zdarma; free plány jsou druh Essentials (od 5 $/měsíc), přechod je
  snadný. **Neověřeno:** zda free plán nabízí TLS, kolik příkazů/s dovolí a zda má region
  v Evropě. Skript z bodu 2 TLS stejně vynutí (odmítne `redis://`).
- **BullMQ vyžaduje** `maxmemory-policy noeviction` a doporučuje zapisování na disk (AOF). Současný
  Redis na Railway má `noeviction`, ale `appendonly: no` — po restartu se ztratí odložené připomínky
  (worker je obnoví z databáze samostatnou úlohou, `restore-reminders`).
- **Odhad využití paměti** (ne měření): 20–100 MB při 10 000 registrovaných uživatelích s 5–20 %
  týdenní aktivitou. Největší položka jsou odeslané e-maily a SMS držené 7 dní bez stropu počtu
  (`deliveryJobOptions` v `src/lib/queue/options.ts`). Při plné paměti Redis odmítne nové úlohy;
  kritická oznámení se zaparkují v outboxu. Po týdnu provozu zkontrolovat využití v konzoli a nastavit
  upozornění na 70 %.

## 🔴 Worker na Railway usíná (Free plán)

**Stav (6. 11. 2026):** služba `lonvita-app` (worker) na Railway, projekt `worthy-youth`, běží na
Free plánu, který vynucuje `sleepApplication: true`. Worker nemá příchozí provoz (práci bere
z Redisu), takže ho Railway po pár minutách uspí.

**Dopad, dokud spí:**
- neodcházejí e-maily, SMS ani připomínky (zůstávají ve frontě v Redisu),
- neběží plánované joby (retence, import akcí, export audit logu, compliance, snapshoty),
- `/api/health` vrací 503 (`worker: false`), protože worker neposílá heartbeat.

**Postup:**
1. Railway → workspace Settings → Plans → **Hobby** (5 $/měsíc, v ceně 5 $ kreditu).
   Volitelně Billing → Usage limits, např. 10 $.
2. Služba `lonvita-app` → Settings → **Serverless / App Sleeping → vypnout**
   (nebo Railway MCP `update-service` se `sleepApplication: false`).
3. Redeploy a ověřit: v logu `queue.worker_started` pro `lonvita`, `lonvita-email`, `lonvita-sms`,
   po ~10 minutách služba neusnula a `/api/health` vrací `worker: true`.

Přesun na Cloudflare zvažován a zamítnut: Workers nespustí dlouho běžící BullMQ worker,
Containers také usínají a Redis je stejně na Railway.

## 🟠 Worker nemá audit bucket

V logu workeru: `worker.audit_export_schedule_registered … bucket=null`, retence `mode="enforce"`.
Noční WORM export audit logu se nespouští. Retence díky kontrole kopie nic nesmaže, ale
`audit_log` a `security_events` rostou a kopie mimo databázi nevzniká.

**Postup:** Railway → `lonvita-app` → Variables: doplnit `AUDIT_EXPORT_BUCKET` (bucket s Object
Lock) a chybějící `S3_*` pro R2 (`S3_BUCKET`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`;
`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID` už tam jsou). Pak redeploy a ověřit v logu, že
`bucket` není `null`.

## Další otevřené body

- **Zálohy:** znovu vygenerovat `BACKUP_PASSPHRASE` (aktuální hodnotu nikdo nezná) a uložit
  do správce hesel; vyměnit R2 token `lonvita-backups-github` (unikl) a přenastavit
  `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`; spustit
  `gh workflow run backup.yml` a `gh workflow run backup.yml -f restore_test=true`.
- **Sentry:** vyměnit `SENTRY_AUTH_TOKEN` (unikl do chatu) v Sentry i ve Vercelu; napojit worker
  (`@sentry/node`); uptime monitor na `/api/health`; alert na délku e-mailové fronty.
- **GitHub:** ruleset pro `main` (povinné kontroly `Lint & typecheck`, `Migrations apply from
  scratch, schema has no drift`, `Integration tests`; zákaz force push a mazání).
- **Vercel:** `"regions": ["fra1"]` ve `vercel.json` (Neon běží v `eu-central-1`).
- **Neon:** zkontrolovat délku History retention (PITR); heslo `neondb_owner` uložit do správce
  hesel.
- **Outbox (#6):** tabulka `outbox` pro kritická oznámení a reconciliation job ve workeru.
