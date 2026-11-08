# Curated party starters and cast

Reviewed 8 November 2026. This is a small editorial collection of three portable v1 quizzes (13 questions), not an online catalogue or cloud library. Little wonders and its existing identifiers/questions are unchanged. Sky high and Wild world each add five questions with stable identifiers and the existing timing/scoring rules. Explanations are editorial paraphrases.

## Sky high

| Question | Primary factual source |
| --- | --- |
| The Sun is a star | [NASA Sun facts](https://science.nasa.gov/sun/facts/) |
| Earth is third from the Sun | [NASA planets](https://science.nasa.gov/solar-system/planets/) |
| Jupiter is the largest planet in our solar system | [NASA planets](https://science.nasa.gov/solar-system/planets/) |
| Neptune is farthest among the eight planets | [NASA planets](https://science.nasa.gov/solar-system/planets/) |
| Moonlight is reflected sunlight | [NASA Moonlight](https://science.nasa.gov/moon/moonlight/) |

“Eight planets” is deliberate; the question does not mix dwarf planets into that category.

## Wild world

| Question | Primary factual source |
| --- | --- |
| An octopus has three hearts | [Smithsonian cephalopods](https://ocean.si.edu/ocean-life/invertebrates/octopuses-squids-and-relatives) |
| Giraffes are the tallest living land animals | [San Diego Zoo](https://animals.sandiegozoo.org/animals/giraffe) |
| Blue whales are the largest living animals by mass | [NOAA blue whale](https://www.fisheries.noaa.gov/species/blue-whale) |
| Honeybees have six legs | [Texas Parks & Wildlife](https://tpwd.texas.gov/education/resources/keep-texas-wild/whats-the-buzzzz/bee-smart) |
| Penguins are birds | [Australian Antarctic Program](https://www.antarctica.gov.au/about-antarctica/animals/penguins/) |

“Living” and “by mass” make the blue-whale question precise.

## Five beats, five original characters

Ember (The Spark), Loop (The Questioner), Twist (The Keeper), Blu (The Guide) and Moss (The Cheerleader) are **new editorial names and presentation roles**, introduced in this quality pass. They are not claimed to be historical names. They map to the existing asset values 1–5; no artwork was regenerated.

The arc is Gather → Question → Locked → Reveal → Finished. It guides the mood and next action without changing a participant’s score, timer, answer choices or abilities. A locked cue is shown only after an actual saved-answer acknowledgement. Reveal follows actual revealed state. A finished game can be provisional, so guide artwork stays neutral; existing correct-answer and genuine completed-game celebration gates remain responsible for celebration, including completed games with zero points. Wrong/missed answers and provisional or early finishes stay neutral. Guide decoration remains separate from instructions and subject artwork.

`starter-quizzes.json` and `party-guide.json` are cross-platform test contracts. Native and web tests compare their models with these fixtures and play every starter through the existing practice rules. The production document format is unchanged; source URLs are not extra quiz fields. The local library remains capped at 25 and does not automatically sync between devices.
