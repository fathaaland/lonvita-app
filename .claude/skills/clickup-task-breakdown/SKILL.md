---
name: clickup-task-breakdown
description: Breaks one ClickUp business-requirement task or Doc spec into small, independently implementable tasks in the dev list of the same Space. Use when asked to prepare a ClickUp spec for development or turn it into dev tickets. Do not use for implementation, atomic engineering tasks, single-task proposals, or work without a ClickUp source.
---

# ClickUp Task Breakdown

Translate one explicit ClickUp task or Doc page into self-contained, business-oriented dev tasks. Preserve the source language and terminology; never invent requirements.

## Workflow

### 1. Load the source and full business context

- Resolve exactly one explicit task ID/URL or Doc page URL; never guess via free-text search.
- Read the task with `clickup_get_task` and `include: ["description"]`; use `clickup_get_task_comments` for documentation links. For a Doc source, fetch its page and identify its parent Doc and Space. Never modify the source.
- List the parent Doc tree with `clickup_list_document_pages`. Fetch relevant pages one at a time with `clickup_get_document_pages`: goals, roles, entities, integrations, NFRs, constraints/out-of-scope, and sibling processes that may define shared rules.
- If no linked documentation exists, continue from the task and disclose that limitation. If sources are unreadable or contradictory, stop and report the exact gap.

### 2. Confirm intent

Run `interview-me` against the loaded context, but ask only about business decisions: outcomes, actors, scope, rules, edge cases, ownership, required business data, and definition of done. Never ask the requester to choose technologies, architecture, APIs, files, or implementation details. Do not re-ask answered questions. Explicitly resolve:

- whether an adjacent/shared capability belongs in this requirement or is an external dependency;
- whether the business flow requires initial reference data and who owns providing it.

Continue only from its explicitly confirmed intent, including an out-of-scope statement. If nothing is ambiguous, state that instead of inventing questions.

### 3. Resolve destination and existing work

- Find the unique dev-convention list in the source Space with `clickup_get_workspace_hierarchy` or `clickup_search`. Ask if none or multiple match; never use another Space.
- Read all tasks in that list with paginated `clickup_filter_tasks` to find overlap. Reference existing work as dependencies; do not copy its task structure.
- Search the repository only to identify completed or reusable capabilities and dependencies. Use findings to avoid duplicate scope, not to prescribe technologies, architecture, code identifiers, or file changes; explicitly note when the work is greenfield.

### 4. Draft independently implementable tasks

Split on independently deliverable business outcomes:

- reusable capabilities or integration outcomes;
- distinct user flows or system behaviors;
- separate user experience and system behavior only when each has its own meaningful outcome and acceptance criteria; never split solely by technical layer.

Each task must stand alone and contain only relevant sections:

- **Kontext** — parent capability, source link, and dependency links;
- **Cíl**;
- **User flow / Rozsah**;
- **Byznysová pravidla**;
- **Datový model** — business entities, data, and relationships only;
- **Chybové stavy**;
- **Mimo rozsah**;
- **Akceptační kritéria** — checkboxes.

Describe what and why, including observable behavior, rules, business data, errors, exclusions, and acceptance criteria from confirmed sources only. Do not prescribe implementation steps, technologies, architecture, APIs, code identifiers, or files. Note blocking relationships as `depends on <task>` in descriptions.

### 5. Confirm, create, and report

1. Show the target list plus proposed titles and one-line scopes. Obtain explicit confirmation; revise and reconfirm after changes.
2. Create standalone tasks with `clickup_create_task`; use subtasks only when explicitly requested.
3. Add every drafted dependency with `clickup_add_task_dependency`, using `waiting_on` on the dependent task.
4. Do not alter the source unless explicitly asked.
5. Report created titles and URLs, plus any confirmed assumptions or documentation limitations.
