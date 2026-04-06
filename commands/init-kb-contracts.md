# Init KB — Cross-Project Contracts

Generate cross-project contracts document by reading all project cards in the Knowledge Base.

**KB path:** $ARGUMENTS

---

## Process

### 1. Read all project cards
Read every file in `{kb_path}/projects/`. Understand what each project does and its stack.

### 2. Read actual API surfaces
For each project referenced in the cards, read the source code to map actual contracts:
- API endpoints (routes, controllers)
- Request/response shapes (DTOs, schemas)
- Auth mechanism
- Error response formats
- Shared type definitions

### 3. Generate cross-project-contracts.md

Write to `{kb_path}/cross-project-contracts.md`:

```markdown
# Cross-Project Contracts

How the services communicate.

## {service-a} --> {service-b} (HTTP/gRPC/queue)

### Endpoints called
| Caller method | Endpoint | Cache TTL |
|--------------|----------|-----------|

### Type contracts
{Response shapes used by the caller}

## {service-b} --> {service-c}
...

## Shared Type Mappings
{If the same concept (e.g. user, visa status) exists across services — how it maps}

## Local Dev Setup
{How to run all services together}

## Related
[[project-a]], [[project-b]], [[project-c]]
```

### 4. Generate HOME.md
Update `{kb_path}/HOME.md` with system diagram and links to all project cards.

### 5. Report
Show what was created. Suggest next steps:
- "Run `/init-claudemd` in each project to generate project-specific CLAUDE.md"
- "Run `/validate-claudemd` to verify each CLAUDE.md is complete"
