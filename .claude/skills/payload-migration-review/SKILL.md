---
name: payload-migration-review
description: Checks and safely consolidates Payload schema migrations against current main. Use when changing Payload database schema or migrations, and before completing a feature with those changes. Always ask before merging main.
---

# Payload Migration Review

## Boundaries

- Review files and SQL only. Do not apply migrations, reset databases, or run tests without explicit authorization.
- Never rewrite migrations or snapshots already on `main`.
- Replace feature migrations only when confirmed undeployed to shared databases. Unknown deployment status blocks replacement; a local migration status alone is not proof. Never automatically reset a local database.
- In read-only or planning mode, report findings without merging or generating anything.

## Workflow

### 1. Establish the baseline

- Require a feature branch, a clean working tree, and no merge/rebase in progress. Otherwise stop; do not stash, reset, or commit user changes.
- Fetch current `origin/main` and record its SHA. If fetching fails, stop rather than use a stale baseline.
- If that SHA is not an ancestor of `HEAD`, **ask for explicit approval before merging it into the feature branch**. Approval to implement a feature is not merge approval. If declined, report blocked and do not regenerate migrations.
- After approval, merge the recorded SHA. Stop on conflicts; do not automatically resolve migration history conflicts. Skip the merge if already incorporated.
- Compare the feature against this SHA throughout the review. A Git merge updates migration inputs, not the live database schema.

### 2. Check schema and migration structure

- Read `package.json` and `src/payload.config.ts`; inspect changes to collections, globals, shared fields, plugins, adapter configuration, and relevant dependencies.
- Identify actual persisted schema changes. Labels, access rules, and generated TypeScript differences alone do not establish a database change. Do not force an empty migration when no schema change exists; still review changed migrations.
- In `src/migrations/`, count migrations added by the feature, not those brought in from `main`. A `.ts` migration and its `.json` snapshot count as one migration.
- For schema changes, require exactly one new migration with a matching snapshot, registered exactly once and last in `src/migrations/index.ts`. It must also sort last by filename, with its snapshot last among snapshots. Check imports, names, missing files, and duplicates.
- Require all baseline migrations and snapshots to remain unchanged and baseline registrations to retain their order.

### 3. Regenerate when necessary

Regenerate if the migration is missing, there are multiple feature migrations, it is not last, or its content is incorrect. Stop instead if baseline history is inconsistent or replacement safety is unconfirmed.

1. Inspect all migrations being replaced. Preserve required manual SQL, backfills, and their ordering; ask if their intent is unclear.
2. Remove only the replaceable feature migration files, their JSON snapshots, and their index entries. Keep all baseline files and registrations intact.
3. Run `pnpm payload migrate:create <descriptive_name> --skip-empty`. Use a short English `snake_case` name describing the change; let Payload add the timestamp prefix. Omit `--skip-empty` only for intentional manual data migrations or backfills without schema changes, including restoring manual SQL during consolidation. Payload 3.88 generates from the last lexicographically sorted JSON snapshot, **not the live database or the index**. Leaving obsolete feature snapshots can produce an empty or incomplete migration.
4. Restore required manual data operations in the new migration. Check rename prompts carefully; do not blindly accept destructive interpretations. If no change is detected despite an expected schema delta, investigate instead of forcing a blank migration.
5. Repeat the structural and content checks. Do not merely reorder the index to hide an incorrectly ordered filename.

### 4. Review content

- Compare `up`, `down`, and the new snapshot with the intended feature schema delta and the baseline migration history. Include version, relationship, and localization tables where applicable.
- Ensure all intended changes are covered, no unrelated changes appear, and no table, column, enum, index, or constraint is recreated when it already exists at that point in the migration sequence.
- Inspect destructive changes, renames, type conversions, defaults, constraints, backfills, and rollback safety; flag potential data loss or unclear intent for user review.
- Historical manual migrations may have no snapshot. Compare their SQL effects too; a snapshot alone is not proof of the baseline schema. If SQL history and snapshots disagree, report blocked rather than rewrite history or conceal the mismatch with `IF NOT EXISTS`.

## Report

Report **OK / not applicable / blocked**, baseline SHA, expected schema changes, feature migration count and ordering, repairs made, and unresolved risks. State explicitly that this was a static review and migrations were not executed against a database; runtime verification requires separate approval.
