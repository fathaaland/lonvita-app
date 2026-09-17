#!/bin/bash
# Run eslint on the edited file (ts/tsx/js/jsx only)

FILE=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')})")

if echo "$FILE" | grep -qE '\.(ts|tsx|js|jsx)$'; then
  cd "$(git rev-parse --show-toplevel)" || exit 1
  exec pnpm eslint "$FILE"
fi
