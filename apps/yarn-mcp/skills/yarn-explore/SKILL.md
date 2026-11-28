---
name: yarn-explore
description: Answer a question about the person's own chat archive - their recurring themes, research threads, how ideas connect across conversations, what they worked on when - from the YaRN-MCP tools, citing every claim to a conversation.
metadata:
  version: 1
---

# Explore the archive

The archive is the person's exported chat history, indexed by the YaRN-MCP tools. Everything you say
about it must come from a tool result. Cite conversations as the tools return them, for example
`[c:1f2e3d4c]`. When a tool shows nothing for something, say so; never fill the gap from general
knowledge or guess what a conversation contained.

## Steps

1. **Orient.** `archive_status` once: how many conversations, the date span, how many themes and
   threads. If `conversations` is 0, stop and say the archive is empty (`yarn-mcp ingest PATH`).
2. **Pick the question type** and load its playbook:
   `load_skill(name: "yarn-explore/questions.md")`. Types: themes (what do I keep coming back to),
   thread (how did my thinking on X develop), connections (how does X relate to Y), period (what was I
   doing in month M), find (where did I discuss X).
3. **Gather.** Use the fewest calls that answer the question: `list_themes` (sort `personal` for the
   themes the person wrote most of), `theme_card`, `research_threads`, `connections`, `timeline`,
   `search`. Read a conversation with `get_conversation` only to quote it or to settle what it says;
   keep `max_tokens` at 1500 or less unless a quote needs more.
4. **Answer** in short paragraphs or a list: each theme, thread or link named with its label and id
   (`T04`, `R02`), its dates, and one to three citations. Separate what the index computed (themes and
   threads are term-statistics clusters and can be noisy) from what a conversation actually says.
5. If the person wants the material in one long-context file, hand off to the `yarn-distill` skill.
