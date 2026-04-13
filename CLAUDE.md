# Global Claude Instructions

## Commit Messages
Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `style:`, `perf:`
Keep subject under 72 chars. Body optional — explain "why" not "what".

## Auto-invoke agents on these triggers

### runtime-debug-agent
Trigger immediately when the user reports ANY of:
- Error messages, stack traces, console logs
- "broken", "not working", "doesn't work", "something wrong"
- Application crash or unexpected behavior

Do NOT try to debug manually first. Always use runtime-debug-agent.

After it completes and creates PLANNING.md:
- Read PLANNING.md to identify fix domain
- If frontend fix → implement directly following the plan
- If backend fix → implement directly following the plan
- Always validate after fixing

### test-all-agent
Trigger when user asks to fix failing tests, get test suite passing, or clean up broken tests.

### fe-test-all-agent
Trigger when user asks to fix failing frontend tests specifically.

## Knowledge Base Workflow
When a project has an Obsidian knowledge base:
- Read knowledge base files **when relevant to the task**, not on every session start
- After completing work: update changelog
- Persistent knowledge belongs in the knowledge base, not in `.claude/` working files

@RTK.md
