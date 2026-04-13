# Brainstorm — Idea to Design & Research

Turn an idea into a concrete design before any code is written.
Also covers library/approach research — no need for a separate command.

**Topic:** $ARGUMENTS

---

## Mode Detection

**Design mode** (default): topic describes a feature, change, or problem to solve.
**Research mode**: topic asks to compare libraries, evaluate approaches, or pick a tool.

For research mode → skip to Step 4 (Propose Approaches) with structured comparison format:
- Options compared (pros, cons, size impact, type support, maintenance status)
- Single recommendation with reasoning for this project's stack
- Integration path (install command, key setup steps, usage example)

---

## Rules
- **No code until design is approved.** Not even "simple" tasks — unexamined assumptions waste the most work on "obvious" changes.
- **One question at a time.** Prefer multiple choice when possible.
- **YAGNI ruthlessly.** Remove anything speculative from the design.

---

## Process

### Step 1: Understand Context
- Read CLAUDE.md and relevant project files
- Check recent commits to understand current state
- If topic involves an existing feature, read its code first

### Step 2: Scope Check
If the request describes multiple independent subsystems — flag it. Help decompose into sub-projects before diving into details. Each sub-project gets its own brainstorm → plan → implementation cycle.

For appropriately-scoped requests, proceed to questions.

### Step 3: Clarifying Questions
Ask questions **one at a time** to understand:
- What problem are we solving?
- Who is it for?
- What are the constraints?
- What does success look like?

Stop asking when you have enough to propose approaches. Don't over-question simple topics.

### Step 4: Propose Approaches
Present **2-3 approaches** with trade-offs:
- Lead with your recommendation and explain why
- Keep descriptions concise — trade-offs matter more than details
- If one approach is clearly superior, say so

### Step 5: Present Design
Once the user picks an approach:
- Present the design in sections, scaled to complexity (a few sentences if simple, more if nuanced)
- Ask after each section: "Does this look right?"
- Cover what's relevant: architecture, components, data flow, error handling
- Follow existing codebase patterns — explore before proposing new ones

### Step 6: Get Approval
When all sections are approved:

> "Design complete. Ready to proceed with planning? Use `/task` to start implementation pipeline, or `/quick` if this is a small change."

---

## Key Principles
- **Explore before proposing** — read existing code, follow established patterns
- **Smaller units** — break into pieces with one clear purpose and well-defined interfaces
- **Incremental validation** — present sections, get approval, then move on
- **Be flexible** — go back and clarify when something doesn't fit
- **Design for the project** — not for a hypothetical future
