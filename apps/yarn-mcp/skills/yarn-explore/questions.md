# Question playbooks

## themes: "what do I keep coming back to?"
- `list_themes(sort: "size")`, then `list_themes(sort: "personal")`: a theme with high `user_share`
  is the person's own voice (long prompts, notes, drafts); low `user_share` means mostly assistant
  prose on a topic they asked about.
- Recurrence: a theme whose `first` and `last` are months apart, or that has research threads
  (`research_threads(theme: ...)`), is one they return to. A big theme active for one week is a burst.
- Report the top five to eight with label, size, span, and one example citation each.

## thread: "how did my thinking on X develop?"
- `research_threads(query: "X")`. If none match, `search(query: "X")` and order the hits by date.
- For the strongest thread, read the first and the last member with `get_conversation` (small
  `max_tokens`) and say what changed between them, quoting both.
- `timeline(term: "X")` shows when it was active.

## connections: "how does X relate to Y?"
- Find the themes for X and for Y (`search` or `list_themes`), then
  `connections(theme: A, other_theme: B)`: `in_both` are conversations that sit in both themes,
  `links` are neighbour pairs across them with the terms (`via`) that join them.
- `connections(term: "X")` gives the co-occurring terms and the themes the term runs through.
- `connections(conversation: ...)` from a key conversation shows its nearest neighbours.

## period: "what was I doing in month M?"
- `timeline()` for the archive, then `search` with `since`/`until` around the month, or
  `theme_card` for the themes whose `by_month` peaks there.

## find: "where did I discuss X?"
- `search(query: "X")`; add `role: "user"` to find what the person wrote rather than replies.
- Quote the snippet and cite the conversation; offer `get_conversation` for more.
