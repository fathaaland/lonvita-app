---
name: publish-github-review
description: Use when explicitly asked to publish code review comments on a GitHub pull request. Not for local reviews or creating PRs.
---

# Publish GitHub Review

- Write review comments and summaries in Czech. Keep code and identifiers in English.
- Be concise, factual, and respectful. Describe the problem, its impact, and a suggested fix.
- Publish only actionable findings supported by the code. Skip speculation, stylistic preferences, and praise-only comments.
- Attach each finding to the relevant diff lines. One issue per comment.
- Check existing review comments and avoid duplicates.
- Verify the target PR and current diff before publishing.
- Default to COMMENT. Use APPROVE or REQUEST_CHANGES only when explicitly requested.
