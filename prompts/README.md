# Implementation prompts

One file per piece of work, written **before** the code and approved by the user (step 4–5 of the loop in `AGENTS.md`).

A prompt is the record of *why* a change looks the way it does. The code says what it does; this says what was decided, what was rejected, and what had to be true for it to be correct.

## Naming

`NN-short-kebab-name.md`, numbered in the order the work was started:

```
prompts/01-code-editor-window.md
prompts/02-docs-page-pagination.md
prompts/03-widget-visual-grouping.md
```

A bug pass or a batch of small fixes gets one file, not one per fix.

## Rules

- Copy `TEMPLATE.md` and fill every heading. A heading with nothing under it means that question was not asked yet.
- Write it after reading the code, not before — "Code I inspected" must list real files you opened.
- State assumptions explicitly. An assumption written down is a decision the user can correct in one line; an assumption left implicit is a rewrite.
- Keep the file after the work ships. It is history, not scaffolding — do not delete or rewrite an approved prompt when the feature later changes. Write a new one.
- Detail and rationale belong here. The closing report in chat stays short.

## Relationship to the progress tracker

`prompts/` is per-change and written up front. `.claude/context/progress-tracker.md` is the running state of the project and is updated **after** the work lands — current phase, what is done, what is next, open questions, architecture decisions. Both get written; neither replaces the other.
