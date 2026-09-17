Run full project validation: typecheck and build.

## Step 1: Typecheck

1. Run `pnpm typecheck`
2. If it fails, analyze the TypeScript errors and fix them.
3. Re-run `pnpm typecheck` to verify. Repeat up to 3 times.
4. If Payload types seem stale, run `pnpm generate:types` first.

## Step 2: Build

1. Run `pnpm build`
2. If it fails, analyze the errors and fix them. Common issues:
   - TypeScript type errors — fix the types
   - Missing imports/exports — add or correct them
   - Payload import map out of date — run `pnpm generate:importmap`
3. Re-run `pnpm build` to verify. Repeat up to 3 times.

## After fixes

- Run `pnpm prettier --write .` on any files you changed to ensure formatting is correct.
- Do NOT weaken types (no `any` casts or `@ts-ignore` unless no better alternative).
- Do NOT add eslint-disable comments unless absolutely necessary.
- If a fix requires a design decision, describe the options instead of picking one silently.

## Final report

Provide a clear summary:
- **Typecheck**: pass/fail (errors found and fixed)
- **Build**: pass/fail (errors found and fixed)

$ARGUMENTS
