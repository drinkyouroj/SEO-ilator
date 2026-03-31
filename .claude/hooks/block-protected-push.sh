#!/bin/bash
# block-protected-push.sh
# Claude Code PreToolUse hook that blocks direct git push to main or develop.
# Forces the PR-only workflow defined in CLAUDE.md.

# Read the tool input from stdin
INPUT=$(cat)

# Extract the command being run
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# If no command found, allow (not a Bash tool call we care about)
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Check for git push targeting protected branches
# Matches: git push origin main, git push origin develop, git push --force origin main, etc.
if echo "$COMMAND" | grep -qE 'git\s+push\s+.*\b(main|develop)\b'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Direct push to protected branches (main, develop) is blocked. Use `gh pr create` to open a pull request instead. See CLAUDE.md Git Flow rules."
    }
  }'
  exit 0
fi

# Check for git push without explicit branch when on main or develop
# This catches `git push` or `git push origin` when the current branch is protected
CURRENT_BRANCH=$(git -C "$(echo "$INPUT" | jq -r '.cwd // "."')" rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "develop" ]; then
  if echo "$COMMAND" | grep -qE '^git\s+push(\s+(-[a-zA-Z]+\s+)*origin)?\s*$'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "You are on the '"$CURRENT_BRANCH"' branch. Direct push to protected branches is blocked. Use `gh pr create` to open a pull request instead."
      }
    }'
    exit 0
  fi
fi

# Allow everything else
exit 0
