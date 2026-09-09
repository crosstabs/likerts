# Conditional visibility

Schema version 3 adds one optional `visibleWhen` predicate to a question:

```json
{"questionId":"return","operator":"equals","value":"no"}
```

The language is deliberately bounded: one predicate, one source question and no nested Boolean expressions. `equals` and `not_equals` compare scalar text, date, number, scale or single-choice answers. `includes` and `not_includes` test one option ID in a multiple-choice answer. `answered` and `not_answered` omit `value`; strings are answered only when they contain a non-whitespace character. Structured schema-v3 choice answers use their `selected` IDs for the same comparisons.

The backend rejects unknown or self references, unsupported operators, missing or forbidden values, incompatible source types, invalid choice IDs, invalid numeric/scale comparison values and every dependency cycle. A condition may reference any question in the survey because the acyclic graph has a deterministic evaluation order.

A hidden source has no effective answer. `answered` is therefore false and `not_answered` true. All four comparison operators are false when the effective source answer is absent; this prevents `not_equals` or `not_includes` from revealing a question before the respondent answers its source.

Hidden questions are absent from validation and their answers are discarded before persistence. A hidden required question is not required. Each SDK applies the same rules while editing: when an answer change hides a dependent question, the renderer removes that dependent answer and recursively prunes newly hidden descendants. The server repeats normalization and validation and remains authoritative.

`conditional-survey.example.json` and `conditional-response.example.json` are the shared positive fixtures. Backend tests cover invalid references, cycles, operators and values; every SDK suite covers visibility and stale-answer removal.
