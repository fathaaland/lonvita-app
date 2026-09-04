---
name: prepare-implementation-proposal
description: Creates short, high-level proposals from existing plans and publishes approved drafts to ClickUp. Use after planning and before implementation.
---

# Prepare Implementation Proposal

Produce a standalone proposal for approval or clarification. Preserve the plan's intent and scope; do not implement it.

## Output

Use these sections in the user's language:

- **Open Questions:** Questions for the requester needed to clarify ambiguous requirements, scope, expected outcomes, or priorities before implementation. Put blocking questions first, number them `Q1`, `Q2`, and so on, and omit technical decisions the implementer can make.
- **Proposed Approach:** Two to five ordered steps describing outcomes and system responsibilities, never implementation.
- **Notes:** Only material assumptions, risks, or alternatives, labeled by type. Never use an assumption to hide an unclear requirement.

## ClickUp Publishing

1. Verify exactly one task from an explicit ClickUp ID or URL, or a Git branch candidate via `clickup_get_task`.
2. If it is missing or ambiguous, ask the user; never search by free text or guess.
3. Show its name, ID, URL, and exact comment, then obtain explicit confirmation.
4. Create a new comment with `clickup_create_comment` and `notify_all: false`, then verify it.

Do not change other task data. If blocked, preserve the approved text and report why. Before retrying an uncertain write, check existing comments to avoid duplicates.

## Rules

- Stay within 200 words and use short bullets or numbered steps.
- Include all sections; write `None` in the user's language when one is empty.
- Preserve code identifiers and do not invent requirements or constraints.
- Describe only outcomes and responsibilities, without implementation details or unrelated improvements.
