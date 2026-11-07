# Provoz: co zbývá udělat

Úkoly mimo kód, které jsou nutné, než Lonvita poběží spolehlivě v ostrém provozu.

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
