# Init Knowledge Base — Scan Project

Scan the current project and generate Knowledge Base entries.

**KB path:** $ARGUMENTS

If no path provided, ask the user for the KB location.

---

## Process

### 1. Verify KB structure
Check that the KB path exists and has the expected structure. If not, create it:
```
{kb_path}/
  projects/
  changelog/
  backlog/
  decisions/
  research/
  HOME.md
  cross-project-contracts.md
  tech-debt.md
```

### 2. Scan current project
Read systematically — do NOT skim:

**Project identity:**
- `package.json`, `pyproject.toml`, `pubspec.yaml`, `Cargo.toml` — name, language, deps, scripts
- `README.md` — project description
- `CLAUDE.md` — if exists, extract architecture and patterns
- `Dockerfile`, `docker-compose.yml` — deployment setup
- `.env.example`, `.env` patterns — configuration

**Existing documentation:**
- `docs/` directory — read all `.md` files (specs, API references, architecture docs)
- Any `.md` files in project root (README, CONTRIBUTING, ARCHITECTURE, etc.)
- `CLAUDE.md` — extract architecture, patterns, anti-patterns, validation commands
- `.claude/` — check for existing pipeline state, plans, context docs from previous work

**Architecture:**
- `ls -R` the top 2 levels of source directory
- Read 3-5 key files to understand patterns (entry point, a route/controller, a service, a model/type)
- Identify: directory structure, layering, module boundaries
- Identify: state management, data fetching, error handling patterns
- Cross-reference with docs/ findings — docs may describe intended architecture, code shows actual

**API surface (if backend):**
- Swagger/OpenAPI spec if exists
- Route files — list all endpoints
- Auth mechanism
- Database (ORM, migrations)

**API consumption (if frontend):**
- How API is called (codegen, manual fetch, SDK)
- State management
- Routing

**Dependencies:**
- Key deps and their purpose
- Any unusual or notable deps

**Known issues:**
- Scan for TODOs/FIXMEs in source files (adapt to project language):
  ```bash
  grep -r "TODO\|FIXME\|HACK\|XXX" src/ --include="*.ts" --include="*.tsx" --include="*.py" --include="*.dart" --include="*.rs" --include="*.java" --include="*.js" --include="*.jsx" | head -30
  ```
- Any obvious anti-patterns found during scan

### 3. Generate KB entries

**Project card** → `{kb_path}/projects/{project-name}.md`
```markdown
# {project-name}
Tags: #{backend|frontend|service}

{One-line description}

## Stack
{Language, framework, key libraries}

## Role
{What this project does in the system — bullet points}

## Key Architecture
{3-5 bullet points about structure, patterns, key decisions}

## Related
- [[other-project]] — {relationship}
```

**Tech debt** → Append to `{kb_path}/tech-debt.md`
```markdown
## {project-name}

### {Issue title} ({severity})
{Description}
- **Fix:** {how to fix}
```

**Changelog** → Create `{kb_path}/changelog/{project-name}/YYYY-MM-DD-<slug>.md` for work found during scan

### 4. Suggest ADRs
List architectural decisions found during scan that should be documented:
- "You use {X} for {Y} — want me to create an ADR explaining why?"
- Only suggest, don't create without confirmation.

### 5. Report
Show what was created/updated. Ask:
- "Is there another repo to scan? Run `/init-kb {kb_path}` there."
- "After all repos are scanned, run `/init-kb-contracts {kb_path}` to generate cross-project contracts."
