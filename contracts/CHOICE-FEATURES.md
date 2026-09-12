# Choice semantics and presentation — schema version 3

Published versions with any `options[].other`, `options[].exclusive` or `presentation` field require schema version 3. Versions 1 and 2 keep their existing representation and validation. A collection cannot bind a version when any declared installed SDK lacks that schema version.

An option may declare `other: {maxLength: 1..10000}`. Each question permits one such option. Its answer becomes exactly `{selected: ["option-id", ...], otherText: {"other-option-id": "text"}}` for both single and multiple choice. Single choice requires exactly one selected ID. `otherText` must contain text only for a selected Other option; deselection deletes the text. Text is mandatory, nonblank, and bounded in Unicode code points. IDs must be known and unique. Ordinary choice questions retain string/string-array answers. Optional questions may be omitted.

An option may declare `exclusive: true` for None of the above. The option's ID and customer-authored label are stored normally; no label matching or magic ID is used. Each question permits one exclusive option, which cannot also be Other. Selecting it clears ordinary choices and their Other text; selecting an ordinary option clears the exclusive one. The server rejects mixed exclusive/ordinary selections. An exclusive selection by itself satisfies the question even when the ordinary minimum is larger than one. NPS/yes-no presets cannot declare special options.

`presentation: "stars"` displays integer scales with minimum 1 and maximum between 1 and 10 as accessible rating controls. It cannot combine with an NPS preset. Answers remain numbers. `presentation: "dropdown"` displays single-choice questions as a collapsed choice control; answers remain choice IDs, or the structured representation when Other is configured. Presentation is part of immutable configuration, not a new answer family. Labels remain customer-owned and are rendered as text.

Conditional visibility compares these answers by selected option IDs, not by the Other text. Text cannot drive conditions in version 3. Hidden-answer handling follows the shared conditional-visibility contract.

Examples: [survey](choice-survey.example.json), [response](choice-response.example.json). [Shared acceptance values](choice-features.json) cover ordinary/Other/None selection, missing or orphan text, bounds, duplicates and unknown IDs. Rendering and transport acceptance must pass across all five SDKs before these features are marked launch-ready.
