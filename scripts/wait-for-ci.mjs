// Holds the production build until GitHub CI has passed on the very commit being deployed — run by
// scripts/vercel-build.sh before anything touches the database. Vercel builds a push to main at once,
// in parallel with CI; without this, the migrations would run (and the release go live) whether the
// tests passed or not.
//
// Waits for every check in REQUIRED_CHECKS to finish on VERCEL_GIT_COMMIT_SHA:
//   - all succeeded (or were skipped)          → exit 0, the build goes on;
//   - any failed, was cancelled or timed out   → exit 1, nothing is migrated or deployed
//     (a newer push to main cancels the older CI run — that commit's deploy stops here, the newer one
//     goes ahead once its own CI passes);
//   - still not done after CI_WAIT_TIMEOUT_MIN → exit 1.
// GitHub unreachable counts as not passed (fails closed). SKIP_CI_WAIT=1 (a hotfix while GitHub is
// down) skips the wait — loudly, and only for the one deployment it is set for.
//
// GITHUB_TOKEN: a fine-grained token with read access to the repository's checks. Optional for a public
// repository, but without it the API allows 60 requests an hour per address, which Vercel's build
// machines share — set it.

/** The job names of .github/workflows/ci.yml — renaming a job there means renaming it here (or setting
 * REQUIRED_CHECKS, names separated by "|"), or every deploy waits for a check that never comes. */
const REQUIRED_CHECKS = process.env.REQUIRED_CHECKS?.trim()
  ? process.env.REQUIRED_CHECKS.split('|').map((name) => name.trim()).filter(Boolean)
  : ['Lint & typecheck', 'Migrations apply from scratch, schema has no drift', 'Integration tests', 'Build']

// Without a token, once a minute: 30 minutes of waiting stays inside the anonymous 60 an hour.
const POLL_MS = process.env.GITHUB_TOKEN ? 20_000 : 60_000
const TIMEOUT_MS = (Number(process.env.CI_WAIT_TIMEOUT_MIN) || 30) * 60_000
const PASSED = new Set(['success', 'skipped', 'neutral'])

const sha = process.env.VERCEL_GIT_COMMIT_SHA
const owner = process.env.VERCEL_GIT_REPO_OWNER
const repo = process.env.VERCEL_GIT_REPO_SLUG
const log = (message) => console.log(`wait-for-ci: ${message}`)

if (process.env.SKIP_CI_WAIT === '1') {
  log('SKIP_CI_WAIT=1 — deploying WITHOUT waiting for CI. Remove the variable once this deploy is out.')
  process.exit(0)
}
if (!sha || !owner || !repo) {
  log('no commit to check (VERCEL_GIT_COMMIT_SHA / _REPO_OWNER / _REPO_SLUG unset) — refusing to deploy blind.')
  process.exit(1)
}

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'lonvita-deploy-gate',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

/** The latest run of each check on the commit, by name (a re-run replaces the earlier one). */
async function checkRuns() {
  const runs = new Map()
  for (let page = 1; page <= 5; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${(await response.text()).slice(0, 200)}`)
    const body = await response.json()
    for (const run of body.check_runs) {
      const seen = runs.get(run.name)
      if (!seen || new Date(run.started_at) > new Date(seen.started_at)) runs.set(run.name, run)
    }
    if (body.check_runs.length < 100) break
  }
  return runs
}

const started = Date.now()
log(`commit ${sha.slice(0, 7)}, waiting for: ${REQUIRED_CHECKS.join(' | ')}`)

for (;;) {
  let pending = REQUIRED_CHECKS
  try {
    const runs = await checkRuns()
    const failed = REQUIRED_CHECKS.filter((name) => {
      const run = runs.get(name)
      return run?.status === 'completed' && !PASSED.has(run.conclusion)
    })
    if (failed.length > 0) {
      for (const name of failed) log(`✗ "${name}": ${runs.get(name).conclusion} — ${runs.get(name).html_url}`)
      log('CI did not pass on this commit — not migrating, not deploying.')
      process.exit(1)
    }
    pending = REQUIRED_CHECKS.filter((name) => runs.get(name)?.status !== 'completed')
    if (pending.length === 0) {
      log(`✓ CI passed (${Math.round((Date.now() - started) / 1000)} s) — going on with the build.`)
      process.exit(0)
    }
  } catch (error) {
    log(`could not read the checks (${error instanceof Error ? error.message : error}) — trying again`)
  }
  if (Date.now() - started > TIMEOUT_MS) {
    log(`CI not finished within ${TIMEOUT_MS / 60_000} min (still waiting for: ${pending.join(' | ')}) — not deploying.`)
    process.exit(1)
  }
  log(`waiting for: ${pending.join(' | ')}`)
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
}
