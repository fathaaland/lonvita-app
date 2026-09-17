# Managed AI tools

Read this reference when adding or changing a managed tool, its server action, approval flow, preview, or registry entry. The shared contracts live in `src/lib/ai/tools/core/contracts.ts`; the implementation lives in `src/lib/ai/tools/core/create-manage-tool.ts`.

## Configuration pattern

- Define one tool per entity with `createManageTool`, and declare mutations with `writeAction`. Register it in `src/lib/ai/tools/registry.ts`. Use the existing entity definitions in `src/lib/ai/tools/defs/` as examples.
- The six managed tools are `manageProgram`, `manageChapter`, `manageBlock`, `manageSubject`, `manageStudyPlan`, and `manageSchool`. Expose only supported actions; a managed tool does not imply full CRUD.
- Keep the model-facing input flat: `{ action, data }`. The generator exposes an action enum and a loose data object, then validates data with the selected action's Zod schema. Do not replace it with a nested discriminated union; Gemini has produced invalid calls with that shape.
- Each write declares `data`, its permission, a scoped `load` when a target exists, `version`, relevant `preconditions`, `preview`, and a `write` handler calling an existing server action. Use `writeAction` to infer the loaded target type.
- Describe action arguments and domain restrictions in the configuration. The generator appends allowed action schemas and preconditions. An administration override replaces only the introductory description, never the generated action list.
- Return the shared `ToolResult` envelope. Map expected action errors to `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `LOCKED`, or `CONFLICT`; do not invent parallel success/error formats or leak internal errors into the chat.

## Permissions and school isolation

- Tool visibility, action permissions, and Payload access are separate checks. Neither a visible tool nor an approved card grants access.
- Declare the correct RBAC flag on each write. The top-level `permission` is only the default for writes without their own override. For example, block creation, editing, and deletion use distinct flags.
- The generator filters write actions and their descriptions using `ctx.permissions`, and checks the flag again before loading a write target. **It does not automatically check a read flag for `list` or `get`.** Setting the top-level permission to a READ flag does not add a read guard.
- For every read, verify that the underlying collection access actually enforces the intended READ flag. Add an explicit check through existing RBAC helpers where needed; a role check or school filter alone is insufficient. Keep generic helpers in `src/lib/rbac/access` and collection-specific logic in `src/access`.
- Read and load through `ctx.db`, which forces the authenticated user and `overrideAccess: false`. Explicitly constrain records to `ctx.schoolId` where the domain requires it. Check related-record membership as well as individual record access. A program outside the active school must not become an editable target.
- Write through authenticated server actions, never directly through Payload from the tool handler. Server actions remain responsible for authorization, validation, domain invariants and atomic mutations.

## Preconditions and approval continuations

- Reuse pure preconditions from `core/preconditions.ts`, such as `programIsDraft`, `blockIsText`, and `parentAcceptsSubBlocks`. Preconditions and `load` must not mutate data.
- Permission, scoped loading, and preconditions run before a card and again after approval. A failed precheck skips the card and returns an error envelope. A changed target can therefore fail even after the user approved it.
- Preserve the route's trust boundary: merge only the client's approval response into the stored tool part. Stored input, tool identifiers and provider metadata remain authoritative. Preserve `callProviderMetadata`, including Gemini thought signatures.
- Keep SDK part states derived from `ai`. An `output-available` part is not necessarily a success: inspect `output.ok`.
- After rejection, the route disables further tool calls for that response using `toolChoice: 'none'`.

## Versions and concurrent saves

- Every write declares `version(target)` for the record whose mutation is protected. Use the loaded record's `updatedAt`; return `null` only when there is no versioned target.
- Choose the version according to the mutation: text edits use the block version; chapter block ordering uses the program version; sub-block ordering uses the parent block version. Subject edits use the subject version, while changes to study-plan membership or allocations use the containing block version. Follow the relevant server action rather than assuming the displayed entity owns the lock.
- The generator reloads after approval and compares this version with `ctx.approvalRequestedAt`, the timestamp of the stored message containing the card. A newer target returns `CONFLICT`.
- This card-time check is not an atomic database lock. Pass the loaded version as `expectedUpdatedAt` to server actions that support it and enforce the comparison at the mutation boundary. Reuse existing locking/transaction helpers.

## Preview and rich text

- Declare preview impact kinds from the shared contract and use `preview.build` for an accurate summary, before/after Markdown, and concrete side effects. The existing fallback is generic; destructive actions need meaningful counts and targets.
- `getChangePreview` resolves the tool under the caller's rights and uses the same parsing, loading and preconditions. Preview generation never writes and never replaces execution-time checks.
- Build the preview from the same normalized data the write will persist. For example, block text excludes its own number/title heading in both preview and stored content. Publishing must disclose the program lock; deletion must disclose affected dependants.
- Use `markdownField` for Markdown input and the existing rich-text conversion utilities for output. Declare `richTextFields` for top-level Lexical fields returned by `get`; do not pass already-converted Markdown through that conversion a second time.
- Keep previews in the shared approval presentation. Extend its existing labels/rendering when necessary instead of adding a separate entity-specific approval mechanism.

## Read output and execution limits

- Return explicit fields, beginning with `id`, `number`, and `title`. Derive outline numbers through `src/lib/programs/program-numbering.ts`; entities without outline positions use `number: null`.
- Lists return at most `READ_LIST_LIMIT` (currently 50), plus `limit` and `truncated`. A database-backed list should fetch one extra result when needed to detect truncation. The generator slices returned items; it does not automatically constrain a handler's database query.
- Do not spread complete Payload records into model output. Use only the fields and relationships required for the action, with bounded reads.
- The route stops after ten steps per request. Each approval continuation starts another request with its own step count.

## Registry changes and Payload migrations

`Skills.activeTools` and `Tools.toolId` derive their select options from the registry. Adding a tool ID changes persisted PostgreSQL enums even when the feature otherwise only adds tool code.

- Inspect all four enum families: `enum_skills_active_tools`, `enum__skills_v_version_active_tools`, `enum_tools_tool_id`, and `enum__tools_v_version_tool_id`. Include versioned collections in both SQL and snapshot review.
- Follow [Payload migration review](../skills/payload-migration-review/SKILL.md). Obtain explicit approval before merging current `main`; never rewrite migrations or snapshots already on `main`.
- After an approved merge, recheck the feature migration against the new baseline. Payload generates from the last lexicographically sorted JSON snapshot, not the live database or migration index. A stale feature snapshot can produce missing changes, duplicate enum additions, or an empty migration.
- Regenerate or consolidate only feature migrations confirmed undeployed to shared databases. Keep exactly one new schema migration with its matching JSON snapshot, registered once and last, and sorting last by filename. Generate with `pnpm payload migrate:create <descriptive_name> --skip-empty`; preserve required manual data operations.
- When remapping enum values during enum replacement, run data updates while the affected column is temporarily text: after `SET DATA TYPE text` and before casting to the replacement enum. Check the ordering in both `up` and `down`. Do not assume adding an enum value makes it usable by a backfill in the same transaction.
- Review rollback behavior when rows already contain the new value. Static review alone cannot establish runtime migration correctness. Database execution or rollback simulations require explicit authorization.
- Regenerate Payload types when appropriate. A label/access-only change does not by itself require a database migration. Dependency changes require the matching lockfile and verification with `pnpm install --frozen-lockfile`.
