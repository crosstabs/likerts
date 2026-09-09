# Pages and bounded forward branching

Schema version 4 adds an optional top-level `pages` array to a survey. A survey without `pages` remains a one-page v1, v2 or v3 survey. A survey with `pages` is v4 even when its questions use only older features.

```json
{
  "pages": [
    {
      "id": "experience",
      "title": "Your visit",
      "questionIds": ["return"],
      "branches": [
        {
          "when": {"questionId": "return", "operator": "equals", "value": "no"},
          "goToPageId": "recovery"
        }
      ]
    },
    {
      "id": "praise",
      "questionIds": ["highlight"],
      "branches": [
        {
          "when": {"questionId": "return", "operator": "equals", "value": "yes"},
          "goToPageId": "contact"
        }
      ]
    },
    {"id": "recovery", "questionIds": ["problem"]},
    {"id": "contact", "questionIds": ["followUp"]}
  ]
}
```

Pages are declared in their canonical forward order. Page IDs use the same bounded identifier syntax as question IDs. A survey has at most 50 non-empty pages, each page has at most 100 question references and 20 branches, and every survey question occurs exactly once across the pages. A page title is optional and limited to 200 characters.

A branch reuses the v3 `visibleWhen` condition shape and operators. Its source question must be on the branch's page or an earlier page, and its destination must be a strictly later declared page. When pages are present, a question's own `visibleWhen` source must likewise be on its page or an earlier page. Unknown sources or destinations, duplicate branch conditions on one page, backward/self edges, duplicate/omitted question references and future-dependent visibility are invalid drafts. These rules make traversal finite and ensure every routing decision can be reconstructed from retained answers.

When the respondent moves forward, the SDK validates only the currently visible required questions on that page. It evaluates branches in declaration order and follows the first true condition. If none match, it advances to the next declared page. The last page completes the survey. Back returns to the page actually visited before the current page, including across a skipped range.

Progress reports the current page's one-based position in the canonical page list and the total canonical page count. A branch may therefore advance from page 1 of 4 to page 3 of 4. This is stable, monotonic while moving forward and honest about the survey's maximum length; Back and an answer change may reduce it.

Changing or removing an answer recomputes the route from the first page. Answers belonging to pages no longer on that route, or questions hidden by v3 conditional visibility, are removed before local validation and submission. The backend repeats the same normalization authoritatively. Requiredness applies only to visible questions on reached pages. Extra answers on skipped pages cannot make themselves reachable and are discarded rather than stored or billed.

Accepted responses remain interpretable without storing mutable UI history: all branch sources are on reached pages, route conditions are frozen in the published schema, and exports include the immutable v4 page definitions alongside questions. Re-evaluating the retained answers against that schema yields the accepted route.
