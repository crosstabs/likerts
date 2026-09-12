# Advanced question families

Schema version 5 adds `ranking`, `matrix` and `constant_sum`. Their wire formats are deliberately bounded and use stable item IDs rather than display labels.

## Ranking

A ranking question has `options` with 2 to 50 unique choices. An answer is an array containing every option ID exactly once, in highest-to-lowest order. Optional ranking questions may be omitted, but a submitted ranking cannot be partial. SDKs present an initially configured order and expose explicit Move up and Move down controls; pointer drag may be an additional interaction but is never required.

```json
{
  "id": "priorities",
  "type": "ranking",
  "label": "Rank these priorities",
  "options": [{"id":"speed","label":"Speed"},{"id":"quality","label":"Quality"}]
}
```

## Matrix

A matrix has 1 to 50 `rows`, 2 to 20 `columns`, at most 200 row-column cells, and `matrixMode` set to `single` or `multiple`. Rows and columns have unique IDs. Choice-only features such as Other and exclusive options are not supported on matrix columns.

Single-mode answers map each answered row ID to one column ID. Multiple-mode answers map each answered row ID to a nonempty array of unique column IDs. Unknown rows or columns, empty selections and duplicate selections are invalid. A required matrix must answer every row; an optional matrix may answer any nonempty subset or be omitted. SDKs render one stacked card per row so the interaction does not require a horizontally scrolling grid.

```json
{
  "id": "experience",
  "type": "matrix",
  "label": "Rate each area",
  "matrixMode": "single",
  "rows": [{"id":"service","label":"Service"}],
  "columns": [{"id":"good","label":"Good"},{"id":"poor","label":"Poor"}]
}
```

## Constant sum

A constant-sum question has 2 to 50 unique `items` and an integer `total` from 1 through 1,000,000. An answer is an object containing every item ID exactly once. Each allocation is a nonnegative integer no greater than the total, and all allocations must sum exactly to the total. Optional questions may be omitted, but submitted allocation objects cannot be partial. SDKs show one numeric input per item and a live remaining amount announced as status text.

```json
{
  "id": "budget",
  "type": "constant_sum",
  "label": "Allocate 100 points",
  "total": 100,
  "items": [{"id":"product","label":"Product"},{"id":"support","label":"Support"}]
}
```

All IDs use the existing bounded identifier rule and item labels use the existing 1-to-500-character choice-label rule. Advanced-family-only properties are rejected on every other question type, and legacy question properties are rejected when they have no meaning for the selected advanced family. Schema versions 1 through 4 retain their existing behavior.

`advanced-openapi-fragment.json` records the schema-5 components incorporated into the authoritative OpenAPI document. JSON Schema expresses the structural bounds; the backend additionally enforces permutation membership, row/column membership, the 200-cell limit and the configured constant sum.
