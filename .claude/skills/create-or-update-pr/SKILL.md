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

## Build the Description

Derive the title and body from the complete diff, commit history, and task context. Do not infer the pull request from the latest commit alone.

Use the repository's pull request template when one exists. Otherwise use:

```markdown
<!-- create-or-update-pr:start -->

## Summary

- Two to four bullets describing the outcome and important behavior changes.

## Notes

- Include only material risks, migrations, limitations, or follow-up work.
<!-- create-or-update-pr:end -->
```

Omit `Notes` when there is nothing material to report. Do not add a verification or testing section unless the repository's pull request template requires it or the user explicitly requests it.

Keep the body concise, normally under 250 words. Describe behavior and reviewer-relevant decisions rather than listing every changed file or commit. Never include secrets, tokens, private logs, or unrelated local information.

## Create or Update

1. Find pull requests for the current head branch before changing remote state.
2. When an open pull request exists, update that pull request instead of creating another one. Preserve its title, base branch, draft state, labels, reviewers, and other metadata unless the user explicitly requests changes.
3. When the body contains `create-or-update-pr` markers, replace only the managed block and preserve all content outside it.
4. When an existing body has no markers, preserve human-authored content. Add or update the generated sections only when this can be done without discarding or duplicating meaningful content; otherwise show the proposed body and ask before overwriting.
5. When no pull request exists, push the current branch with a normal non-force push and create a pull request using a concise imperative title and a body file.
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
