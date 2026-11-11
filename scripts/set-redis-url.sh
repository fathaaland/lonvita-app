#!/bin/sh
# Points production at a new Redis: asks for the rediss:// string (typed hidden, never printed or kept
# in the shell history), checks it is TLS and answers PING, then sets REDIS_URL on Vercel (Production)
# and on the Railway worker — the value goes in through stdin, not through the command line.
#
#   sh scripts/set-redis-url.sh
#
# Run it when the queue is empty (curl <prod>/api/health: "emailsWaiting":0). Redeploy afterwards:
# the script offers to, for both.
set -eu

printf 'Vloz rediss:// retezec noveho Redisu (nic se nezobrazi) a stiskni Enter: '
stty -echo 2>/dev/null || true
read -r URL
stty echo 2>/dev/null || true
printf '\n'

case "$URL" in
  rediss://*) ;;
  redis://*) echo "Tohle neni sifrovane spojeni (redis://). Potrebuji rediss:// (dve s)."; exit 1 ;;
  *) echo "Neni to Redis adresa."; exit 1 ;;
esac

echo "Zkousim spojeni (PING)…"
ANSWER=$(printf '%s' "$URL" | node -e '
  const { Redis } = require("ioredis");
  let url = ""; process.stdin.on("data", (c) => (url += c)).on("end", async () => {
    const r = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 8000, lazyConnect: true });
    try { await r.connect(); console.log(await r.ping()); const p = await r.config("GET", "maxmemory-policy").catch(() => null); console.log("policy:" + (p ? p[1] : "(unreadable)")); }
    catch (e) { console.log("FAIL " + e.message.slice(0, 120)); }
    r.disconnect();
  });')
echo "$ANSWER"
echo "$ANSWER" | grep -q PONG || { echo "Spojeni nefunguje — nic jsem nezmenil."; exit 1; }
echo "$ANSWER" | grep -q "policy:noeviction" || echo "POZOR: eviction neni noeviction — BullMQ vyzaduje noeviction. Vypni eviction v nastaveni databaze, pred nasazenim."

printf 'Nastavit REDIS_URL na Vercelu (Production) a na Railway workeru? [ano/ne] '
read -r OK
[ "$OK" = "ano" ] || { echo "Zruseno."; exit 0; }

printf '%s' "$URL" | pnpm dlx vercel@latest env add REDIS_URL production --force --sensitive --scope lonvita >/dev/null
echo "Vercel: nastaveno."
printf '%s' "$URL" | railway variable set REDIS_URL --stdin --service lonvita-app --skip-deploys >/dev/null
echo "Railway: nastaveno (worker se jeste nerestartoval)."
unset URL ANSWER

echo
echo "Hotovo. Dalsi krok: redeploy Vercelu (Deployments -> Redeploy) a na Railway Deploy ve sluzbe lonvita-app."
