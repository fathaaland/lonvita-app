---
name: create-or-update-pr
description: Creates or updates a GitHub pull request for the current branch with a concise, evidence-based description. Use only when the user explicitly asks the agent to create, open, publish, or update a PR. Reuse an existing open PR for the branch instead of creating a duplicate. Do not use for commits, merges, releases, or implicit post-change automation.
---

# Create or Update PR

Create exactly one open pull request for the current branch, or update the existing open pull request. Use the GitHub CLI (`gh`); GitHub MCP is not required. Do not merge the pull request.

## Check Preconditions

1. Read applicable repository instructions and any pull request template.
2. Run `gh auth status`. Stop with a concrete login instruction when `gh` is unavailable or unauthenticated.
3. Resolve the current branch and the repository's default or user-specified base branch. Do not assume the base branch is `main`.
4. Stop on a detached HEAD or when the current branch is the base branch.
5. Inspect `git status --short`. Stop when staged, unstaged, or untracked changes exist because they would not be included in the pull request. Do not commit them automatically.
6. Compare the complete branch against the base branch and confirm that the branch contains commits to publish.

## Build the Title

For new pull requests and explicitly requested title changes, use:

```text
<type>: <short description>
```

- Allowed types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, matching the commit conventions.
- Write the description in English, in the imperative mood, without a trailing period.
- Aim for a total title length of 80 characters or fewer.
- Describe the complete pull request change, not just the latest commit.
- Do not include ClickUp task IDs in the title.
- Preserve the existing title during ordinary pull request updates unless the user explicitly requests a title change.

Example: `feat: add task creation form`

## Build the Description

Derive the title and body from the complete diff, commit history, and task context. Do not infer the pull request from the latest commit alone.

Use the repository's pull request template when one exists, incorporating the information below into equivalent sections without duplication. Otherwise use:

```markdown
<!-- create-or-update-pr:start -->

## Summary

- One to three bullets describing the outcome and important behavior changes.

## ClickUp

https://app.clickup.com/t/<task-id>

## How to test

- One to three concrete checks, each with an expected result.

## Breaking changes

- Describe the contract change, affected consumers, and required updates or deployment order.

## Notes

- Include only other material risks, migrations, limitations, or follow-up work.
<!-- create-or-update-pr:end -->
```

Always include the ClickUp link and brief testing scenarios:

- Resolve the ClickUp link from task context or the `CU-<task-id>` branch name. If the task cannot be identified unambiguously, ask the user for its link before publishing; never invent a task ID or publish the placeholder.
- Write `How to test` as instructions, not as claims that verification was performed. Cover the main changed behavior and a relevant failure or regression case where applicable. Writing scenarios does not authorize running tests or browser automation.
- Inspect the complete diff for breaking changes, especially backend changes that can break frontend consumers: API fields and response shapes, validation, authentication, permissions, and removed or renamed endpoints. Report identified incompatibilities with their FE impact and required consumer update or deployment order. Do not assume unavailable consumers are compatible; note material uncertainty briefly in `Notes`.
- Omit `Breaking changes` when no breaking change is identified. Omit `Notes` when there is nothing else material to report, and do not repeat information from other sections.

Keep the body minimalist, aiming for 150 words or fewer. Describe behavior and reviewer-relevant decisions rather than listing every changed file or commit. Never include secrets, tokens, private logs, or unrelated local information.

## Create or Update

1. Find pull requests for the current head branch before changing remote state.
2. When an open pull request exists, update that pull request instead of creating another one. Preserve its title, base branch, draft state, labels, reviewers, and other metadata unless the user explicitly requests changes.
3. When the body contains `create-or-update-pr` markers, replace only the managed block and preserve all content outside it.
4. When an existing body has no markers, preserve human-authored content. Add or update the generated sections only when this can be done without discarding or duplicating meaningful content; otherwise show the proposed body and ask before overwriting.
5. When no pull request exists, push the current branch with a normal non-force push and create a pull request using the title format defined above and a body file.
6. When only a closed or merged pull request exists for the branch, stop and ask for direction. Do not reopen it or create a duplicate automatically.

Use a temporary body file with `gh pr create --body-file` or `gh pr edit --body-file` instead of embedding multiline Markdown directly in a shell command.

## Report the Result

Verify the remote pull request after the operation. Report whether it was created or updated, then provide its title, base and head branches, draft state, and URL.

## Boundaries

- Act only after an explicit request to create or update a pull request.
- Do not create commits or branches.
- Do not force-push, merge, close, reopen, approve, or request reviews.
- Do not add labels, assignees, milestones, or projects unless explicitly requested.
- Stop and explain the exact blocker when authentication, repository state, or permissions prevent a safe operation.
