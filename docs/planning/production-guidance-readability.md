# Production guidance readability review

Reviewed the changed guidance and shared-rate-limit proposal for engineers operating
Monque. Applied writing-clearly-and-concisely, clear-writing (technical prose), humanizer,
and readability, including the requested Elements of Style reference.

## Method and estimates

Compared normalized prose paragraphs with the branch baseline. Included new or changed
paragraphs, list items, and table cells; excluded frontmatter, imports, headings, fenced
code, inline code, link destinations, and the proposal's status metadata. Unchanged
sentences within a changed paragraph remain in the sample. This report is excluded.

Counts use alphabetic word tokens and punctuation-based sentence boundaries; list and
table fragments count as sentence units. Syllables use vowel groups with terminal silent
“e” and “ed” adjustments, with a minimum of one. Complex words have at least three
estimated syllables. Passive voice uses a simple auxiliary-plus-participle pattern.
These rules make the results reproducible estimates, not a measure of comprehension.

| Sample                       | Words | Sentences | Reading ease | FK grade |  Fog | SMOG |
| ---------------------------- | ----: | --------: | -----------: | -------: | ---: | ---: |
| Production checklist changes |   703 |        58 |         41.9 |     10.4 | 13.1 | 12.2 |
| Jobs guidance changes        |   132 |         9 |         36.2 |     11.9 | 14.0 | 13.0 |
| Workers guidance changes     |    43 |         4 |         48.4 |      9.2 | 10.8 | 10.7 |
| Shared-rate-limit proposal   | 2,625 |       218 |         37.9 |     11.0 | 14.5 | 12.9 |
| Combined                     | 3,503 |       289 |         38.8 |     10.9 | 14.1 | 12.7 |

Combined averages: 12.1 words per sentence unit and 5.5 characters per word. The sample
contains 812 complex words (23.2%) and an estimated 12 passive sentences. Short samples,
especially the Workers change, are too small for stable grade estimates; SMOG is most
useful on longer passages.

## Interpretation and editorial checks

Reading ease falls in the difficult range. Terms such as concurrency, idempotency,
transaction, and initialization raise the estimates but carry distinctions this technical
audience needs. Sentence lengths are moderate. No edits were made solely to lower a grade.

The prose review removed an unsupported promise that twice the expected runtime prevents
stale recovery. It names the conditions for periodic recovery and distinguishes concurrent
work from a rate budget. Both payment examples now require a stable provider key; the
transfer example commits a unique record and balance changes together. The linked progress
example explains why progress tracking alone cannot prevent duplicate effects.

The proposal labels current behavior, proposed choices, and decisions requiring approval.
Its examples distinguish token-bucket admission from strict rolling-window quotas and
external request timing. Keep these distinctions during implementation; shortening them
would hide the principal tradeoffs. Review the longer policy-migration paragraphs with
operators during design approval, since readability scores cannot establish that an
upgrade procedure is complete.

## Validation

- `vp run skills list` completed after installing the locked dependencies. No permitted
  dependency skill matched these MongoDB examples; checked the installed driver source
  and its first-party transaction documentation instead.
- Reviewed Claim, heartbeat, and recovery code after loading the installed Effect guidance,
  relevant examples, and module source. Checked concurrency, stale-recovery, renewable-lease,
  and claim-ownership test coverage. This pass did not execute the runtime suite.
- Scoped `vp fmt --threads=1 --check` and `git diff --check` passed. The default formatter
  invocation stalled; the single-thread invocation completed.
- The installed MDX compiler compiled all three edited pages. TypeScript parsed all 28
  TypeScript fences in the checklist and Jobs guide. This is syntax validation, not a
  claim that illustrative application adapters were executed or type-checked.
- All relative source and ADR links in the specification resolve. The new documentation
  links point to existing pages and the existing idempotency-patterns heading.
- `vp run @monque/docs#build` passed: 208 pages built with the site's link validator
  enabled. Initial attempts stalled during native library loading in macOS; the final
  attempt completed after that delay cleared. Existing TypeDoc decorator-tag and bundle
  size warnings do not concern the changed pages.
- The repository commit hook also ran `vp run type-check` and `vp staged` successfully.
  Astro reported zero errors, warnings, or hints across eight files. The hook's broader
  checks were required by the repository; no runtime test suite was run in this pass.
