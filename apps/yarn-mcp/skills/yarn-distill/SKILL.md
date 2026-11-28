---
name: yarn-distill
description: Distill part of the person's chat archive (a query, theme, research thread, chosen conversations, or the whole archive) into one long-context packet under a token limit, and say how to serve it with YaRN.
metadata:
  version: 1
---

# Distill a YaRN packet

`distill_yarn` writes a Markdown packet of cited conversation excerpts no larger than `token_limit`
tokens and returns its manifest. The limit is clamped by the server ceiling and by what YaRN can reach
for the target model: `native_ctx x max_yarn_factor - reserve_tokens`. The manifest's `yarn` block says
whether the packet fits the model's native window and, when it does not, the factor and the serving
flags (`llama_cpp`, `hf_rope_scaling`, `vllm`).

## Steps

1. **Scope.** From the invocation, decide what the packet covers. A topic is `query`; a theme or
   thread id is `theme` / `thread` (find ids with `list_themes` or `research_threads` if the person
   named them in words); a list of conversations is `conversations`; nothing named means the whole
   archive (themes round-robin).
2. **Limit and model.** Use the token limit the person gave (`token_limit`); otherwise leave it out
   and the server default applies. If they named a target model, pass `model` (`qwen3`, `qwen2.5`) or
   its `native_ctx` and `max_yarn_factor`. Pass `include_assistant: false` when they want only their
   own words.
3. **Distill once.** Call `distill_yarn`. Do not call it again with the same arguments.
4. **Report** from the manifest only: packet path, `packet_tokens` and how they were counted
   (`token_counter`: `estimate` or `tokenize`), conversations included of considered, redactions, and
   whether it was clamped (quote `clamp_reason`). Then the YaRN plan: "fits natively" when
   `yarn.needed` is false; otherwise the factor, the context, and the llama.cpp flags verbatim. If
   `yarn.fits` is false, say the context does not permit it and give the largest `token_limit` that
   would fit (`token_limit` in the manifest).
