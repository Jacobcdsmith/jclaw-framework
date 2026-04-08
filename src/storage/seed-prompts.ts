/**
 * seed-prompts.ts
 *
 * Seeds the jclaw prompt library with a curated set of high-quality, reusable
 * prompts across common developer and knowledge-worker categories.
 *
 * This module is idempotent: it uses upsertPrompt, so running it multiple times
 * will update existing prompts but never create duplicates.
 *
 * Usage:
 *   import { seedPrompts } from "./seed-prompts.js";
 *   seedPrompts();
 *
 * Or run directly:
 *   npx tsx src/storage/seed-prompts.ts
 */

import { upsertPrompt, getPromptByName } from "./prompts.js";

export interface SeedPromptDef {
  name: string;
  description: string;
  tags: string[];
  content: string;
}

export const SEED_PROMPTS: SeedPromptDef[] = [

  // ── Code Review ───────────────────────────────────────────────────────────
  {
    name: "code-review-thorough",
    description: "A thorough, senior-engineer-level code review covering correctness, security, performance, and maintainability.",
    tags: ["code", "review", "engineering"],
    content: `You are a senior software engineer conducting a thorough code review. Analyze the following {{language}} code with the mindset of someone who cares deeply about correctness, security, performance, and long-term maintainability.

Structure your review in these sections:
1. **Summary** — One paragraph overview of what the code does and your overall assessment.
2. **Correctness** — Logic errors, edge cases, off-by-one errors, incorrect assumptions.
3. **Security** — Injection risks, improper input validation, exposed secrets, auth issues.
4. **Performance** — Algorithmic complexity, unnecessary allocations, blocking operations, N+1 queries.
5. **Maintainability** — Naming clarity, function length, coupling, missing tests, documentation gaps.
6. **Actionable Suggestions** — Numbered list of specific, concrete improvements with code examples where helpful.

Be direct and specific. Cite line numbers or code snippets when referencing issues.

Code to review:
{{code}}`
  },
  {
    name: "code-review-quick",
    description: "A fast, focused code review that surfaces the top 3–5 most important issues.",
    tags: ["code", "review", "quick"],
    content: `You are a senior engineer doing a quick code review. Your goal is to surface the top 3–5 most important issues in this {{language}} code — not an exhaustive list, just the highest-leverage feedback.

For each issue: state the problem clearly, explain why it matters, and suggest a fix. Be terse and direct.

Code:
{{code}}`
  },
  {
    name: "code-review-security",
    description: "A security-focused code review looking for vulnerabilities, injection risks, and auth issues.",
    tags: ["code", "review", "security"],
    content: `You are a security-focused code reviewer. Analyze the following {{language}} code for security vulnerabilities.

Check for:
- Injection vulnerabilities (SQL, command, XSS, SSRF, etc.)
- Improper authentication or authorization
- Insecure deserialization
- Sensitive data exposure (secrets, PII in logs, etc.)
- Insecure cryptography or randomness
- Race conditions or TOCTOU issues
- Dependency risks

For each finding: describe the vulnerability, its severity (Critical/High/Medium/Low), the attack vector, and a concrete remediation.

Code:
{{code}}`
  },

  // ── Debugging ─────────────────────────────────────────────────────────────
  {
    name: "debug-error",
    description: "Systematic debugging help for a specific error or unexpected behavior.",
    tags: ["debug", "engineering"],
    content: `You are an expert debugger. Help me diagnose and fix the following issue.

**Language/Framework:** {{language}}
**Error message or unexpected behavior:** {{error}}
**Code context:**
{{code}}

Please:
1. Identify the most likely root cause(s), explaining your reasoning.
2. Describe what is actually happening vs. what should happen.
3. Provide a concrete fix with corrected code.
4. Suggest how to prevent this class of bug in the future.`
  },
  {
    name: "debug-performance",
    description: "Diagnose and fix a performance bottleneck in code.",
    tags: ["debug", "performance", "engineering"],
    content: `You are a performance engineering expert. Analyze the following {{language}} code for performance bottlenecks.

**Observed behavior:** {{observed_behavior}}
**Expected behavior:** {{expected_behavior}}

Code:
{{code}}

Please:
1. Identify the primary performance bottleneck(s) and explain the root cause.
2. Estimate the algorithmic complexity of the problematic section(s).
3. Provide an optimized version of the code with explanations of the improvements.
4. Quantify the expected improvement if possible (e.g., O(n²) → O(n log n)).`
  },
  {
    name: "debug-explain-error",
    description: "Explain what a cryptic error message means and how to fix it.",
    tags: ["debug", "explain"],
    content: `Explain the following error message in plain English. I am working with {{language}}.

Error:
{{error}}

Please explain:
1. What this error means in simple terms.
2. The most common causes of this error.
3. Step-by-step instructions to diagnose which cause applies to my situation.
4. How to fix each possible cause.`
  },

  // ── Refactoring ───────────────────────────────────────────────────────────
  {
    name: "refactor-clean",
    description: "Refactor code to be cleaner, more readable, and better structured without changing behavior.",
    tags: ["refactor", "code", "engineering"],
    content: `You are an expert in clean code principles. Refactor the following {{language}} code to be cleaner, more readable, and better structured — without changing its observable behavior.

Apply these principles where appropriate:
- Meaningful, intention-revealing names
- Single Responsibility Principle
- DRY (Don't Repeat Yourself)
- Small, focused functions
- Eliminate magic numbers and strings
- Improve error handling
- Reduce nesting and cognitive complexity

Provide the refactored code and a brief explanation of the key changes made and why.

Original code:
{{code}}`
  },
  {
    name: "refactor-to-pattern",
    description: "Refactor code to use a specific design pattern.",
    tags: ["refactor", "patterns", "engineering"],
    content: `Refactor the following {{language}} code to use the {{pattern}} design pattern.

Explain:
1. Why this pattern is a good fit for this code.
2. The key structural changes required.
3. Any trade-offs or caveats to be aware of.

Then provide the fully refactored code.

Original code:
{{code}}`
  },
  {
    name: "refactor-add-tests",
    description: "Analyze code and write a comprehensive test suite for it.",
    tags: ["refactor", "testing", "engineering"],
    content: `You are a test-driven development expert. Write a comprehensive test suite for the following {{language}} code using {{test_framework}}.

Cover:
- Happy path / expected behavior
- Edge cases (empty inputs, boundary values, large inputs)
- Error cases and exception handling
- Any async behavior or side effects

For each test: use a descriptive name that reads like a specification. Add a brief comment explaining what scenario it covers.

Code to test:
{{code}}`
  },

  // ── Writing & Communication ───────────────────────────────────────────────
  {
    name: "write-technical-doc",
    description: "Write clear, professional technical documentation for a feature or system.",
    tags: ["writing", "documentation", "technical"],
    content: `You are a technical writer with deep engineering knowledge. Write clear, professional documentation for the following.

**Subject:** {{subject}}
**Audience:** {{audience}}
**Format:** {{format}}

The documentation should be accurate, well-structured, and written at the right level of technical depth for the audience. Use concrete examples wherever they aid understanding. Include a brief introduction, the main content, and any relevant caveats or limitations.`
  },
  {
    name: "write-commit-message",
    description: "Write a clear, conventional commit message for a set of changes.",
    tags: ["writing", "git", "engineering"],
    content: `Write a clear, professional Git commit message following the Conventional Commits specification for the following changes.

Changes made:
{{changes}}

The commit message should:
- Start with a type prefix: feat, fix, docs, style, refactor, perf, test, chore, ci
- Have a concise subject line (≤72 characters) in the imperative mood
- Include a body paragraph explaining the "what" and "why" (not the "how") if the change is non-trivial
- Reference any relevant issue numbers

Provide 2–3 options ranked from most to least appropriate.`
  },
  {
    name: "write-pr-description",
    description: "Write a professional, informative pull request description.",
    tags: ["writing", "git", "engineering"],
    content: `Write a professional pull request description for the following changes.

**Changes summary:** {{changes}}
**Related issue/ticket:** {{issue}}

The PR description should include:
- **What**: A clear summary of what was changed and why.
- **How**: A brief explanation of the approach taken.
- **Testing**: What was tested and how reviewers can verify the changes.
- **Screenshots** (if applicable): Note where screenshots would be appropriate.
- **Checklist**: A standard checklist (tests pass, docs updated, no breaking changes, etc.)`
  },
  {
    name: "write-email-professional",
    description: "Write a professional, clear email on any topic.",
    tags: ["writing", "communication"],
    content: `Write a professional email with the following details.

**To:** {{recipient}}
**Subject:** {{subject}}
**Key points to convey:** {{key_points}}
**Tone:** {{tone}}

The email should be concise, clear, and appropriately formal. Get to the point quickly, use short paragraphs, and end with a clear call to action or next step.`
  },

  // ── Summarization ─────────────────────────────────────────────────────────
  {
    name: "summarize-article",
    description: "Summarize a long article or document into key points and a concise overview.",
    tags: ["summarize", "research"],
    content: `Summarize the following text concisely and accurately.

Provide:
1. **One-sentence summary** — The single most important takeaway.
2. **Key points** — 3–7 bullet points covering the main ideas, findings, or arguments.
3. **Context & implications** — One paragraph on why this matters and what it means for {{context}}.

Text to summarize:
{{text}}`
  },
  {
    name: "summarize-meeting-notes",
    description: "Transform raw meeting notes into a structured, actionable summary.",
    tags: ["summarize", "productivity"],
    content: `Transform the following raw meeting notes into a clean, structured summary.

Format the output as:
- **Meeting Overview** — Date, attendees (if mentioned), purpose.
- **Key Decisions Made** — Numbered list of decisions reached.
- **Action Items** — Table with: Owner | Task | Due Date (use "TBD" if not specified).
- **Open Questions / Parking Lot** — Items that need follow-up but weren't resolved.
- **Next Steps** — What happens next and when.

Raw notes:
{{notes}}`
  },
  {
    name: "summarize-codebase",
    description: "Summarize what a piece of code or a module does for onboarding or documentation.",
    tags: ["summarize", "code", "documentation"],
    content: `Analyze and summarize the following {{language}} code for a developer who is new to this codebase.

Explain:
1. **Purpose** — What does this code do at a high level?
2. **Key Components** — The main classes, functions, or modules and their roles.
3. **Data Flow** — How data moves through the system.
4. **Dependencies** — Key external dependencies and why they're used.
5. **Entry Points** — Where execution starts and the primary public API.
6. **Gotchas** — Any non-obvious behavior, important assumptions, or known limitations.

Code:
{{code}}`
  },

  // ── Brainstorming ─────────────────────────────────────────────────────────
  {
    name: "brainstorm-solutions",
    description: "Generate a diverse set of creative solutions to a problem.",
    tags: ["brainstorm", "ideation"],
    content: `You are a creative problem-solver. Generate {{count}} distinct, creative solutions to the following problem.

**Problem:** {{problem}}
**Constraints:** {{constraints}}

For each solution:
- Give it a short, memorable name.
- Describe the core idea in 2–3 sentences.
- Note the key advantage and the main trade-off or risk.

Think divergently — include both conventional and unconventional approaches. Prioritize variety over similarity.`
  },
  {
    name: "brainstorm-feature-ideas",
    description: "Brainstorm product feature ideas for a given product and user need.",
    tags: ["brainstorm", "product", "ideation"],
    content: `You are a product strategist. Brainstorm {{count}} feature ideas for the following product and user need.

**Product:** {{product}}
**User need / pain point:** {{user_need}}
**Target user:** {{target_user}}

For each idea:
- Name the feature.
- Describe it in 1–2 sentences.
- Explain the user value it delivers.
- Rate its estimated effort (Low/Medium/High) and impact (Low/Medium/High).

Include a mix of quick wins and ambitious long-term ideas.`
  },
  {
    name: "brainstorm-names",
    description: "Generate creative name ideas for a product, feature, or project.",
    tags: ["brainstorm", "naming", "creative"],
    content: `Generate {{count}} creative name ideas for the following.

**What it is:** {{description}}
**Key qualities to convey:** {{qualities}}
**Audience:** {{audience}}

For each name: provide the name, a one-sentence rationale for why it works, and note any potential issues (hard to spell, existing trademark, etc.).

Include a mix of: descriptive names, abstract/evocative names, portmanteau/invented words, and acronyms.`
  },

  // ── System Design ─────────────────────────────────────────────────────────
  {
    name: "system-design-overview",
    description: "Design a high-level system architecture for a given product or feature.",
    tags: ["system-design", "architecture", "engineering"],
    content: `You are a senior systems architect. Design a high-level architecture for the following system.

**System to design:** {{system}}
**Scale requirements:** {{scale}}
**Key constraints:** {{constraints}}

Your design should cover:
1. **Requirements Clarification** — State your assumptions about functional and non-functional requirements.
2. **High-Level Architecture** — Describe the major components and how they interact (use a text diagram if helpful).
3. **Data Model** — Key entities and their relationships.
4. **API Design** — Primary endpoints or interfaces.
5. **Scalability** — How the system handles growth in users, data, and traffic.
6. **Reliability & Fault Tolerance** — How the system handles failures.
7. **Trade-offs** — Key architectural decisions and their trade-offs.`
  },
  {
    name: "system-design-database",
    description: "Design a database schema for a given domain.",
    tags: ["system-design", "database", "engineering"],
    content: `Design a database schema for the following domain.

**Domain:** {{domain}}
**Key entities and relationships:** {{entities}}
**Database type:** {{db_type}}
**Scale:** {{scale}}

Provide:
1. **Schema definition** — Table/collection definitions with field names, types, and constraints.
2. **Relationships** — How entities relate (foreign keys, embedded documents, etc.).
3. **Indexes** — Which fields to index and why.
4. **Normalization decisions** — Where you normalized vs. denormalized and the reasoning.
5. **Potential issues** — Scaling bottlenecks, migration challenges, or design trade-offs to be aware of.`
  },
  {
    name: "system-design-api",
    description: "Design a RESTful or GraphQL API for a given feature or service.",
    tags: ["system-design", "api", "engineering"],
    content: `Design a {{api_style}} API for the following service.

**Service:** {{service}}
**Key operations needed:** {{operations}}
**Consumers:** {{consumers}}

Provide:
1. **Resource model** — The primary resources and their representations (JSON schemas).
2. **Endpoint definitions** — Method, path, request body, response body, and status codes for each operation.
3. **Authentication & Authorization** — How the API is secured.
4. **Pagination & filtering** — How large collections are handled.
5. **Error handling** — Error response format and common error codes.
6. **Versioning strategy** — How API changes will be managed over time.`
  },

  // ── Explanation & Learning ─────────────────────────────────────────────────
  {
    name: "explain-concept",
    description: "Explain a technical or complex concept at a specified level of depth.",
    tags: ["explain", "learning"],
    content: `Explain {{concept}} to {{audience}}.

Use the following structure:
1. **Simple definition** — One sentence that captures the essence.
2. **Intuitive explanation** — Use an analogy or real-world comparison to build intuition.
3. **How it works** — A deeper explanation appropriate for the audience's level.
4. **Concrete example** — A specific, practical example that illustrates the concept.
5. **When to use it** — The situations where this concept is most relevant or valuable.
6. **Common misconceptions** — 1–2 things people often get wrong about this.`
  },
  {
    name: "explain-code",
    description: "Explain what a piece of code does, line by line or at a high level.",
    tags: ["explain", "code", "learning"],
    content: `Explain the following {{language}} code to {{audience}}.

Provide:
1. **High-level summary** — What does this code accomplish overall?
2. **Step-by-step walkthrough** — Explain what each significant section does.
3. **Key concepts used** — Identify any patterns, algorithms, or language features that are important to understand.
4. **Inputs and outputs** — What does it take in and what does it return/produce?
5. **Potential issues** — Any bugs, edge cases, or limitations worth noting.

Code:
{{code}}`
  }
];

/**
 * Seeds the prompt library with all SEED_PROMPTS.
 * Safe to call multiple times — uses upsert semantics.
 */
export function seedPrompts(): void {
  let inserted = 0;
  let updated = 0;

  for (const def of SEED_PROMPTS) {
    const existing = getPromptByName(def.name);
    upsertPrompt({
      name: def.name,
      content: def.content,
      description: def.description,
      tags: def.tags
    });
    if (existing) {
      updated++;
    } else {
      inserted++;
    }
  }

  console.log(`[jclaw] Prompt seed complete: ${inserted} inserted, ${updated} updated (${SEED_PROMPTS.length} total)`);
}

// ---------------------------------------------------------------------------
// Run directly: npx tsx src/storage/seed-prompts.ts
// ---------------------------------------------------------------------------
const isMain = process.argv[1]?.endsWith("seed-prompts.ts") ||
               process.argv[1]?.endsWith("seed-prompts.js");

if (isMain) {
  seedPrompts();
}
