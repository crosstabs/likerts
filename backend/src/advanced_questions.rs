//! Schema-v5 advanced question configuration and answer validation.
use crate::{bounded, identifier, invalid, Choice, Error, MatrixMode, PromptItem, Question};
use serde_json::Value;
use std::collections::HashSet;

fn valid_items(items: &[PromptItem], minimum: usize, maximum: usize) -> bool {
    let mut ids = HashSet::new();
    (minimum..=maximum).contains(&items.len())
        && items.iter().all(|item| {
            identifier(&item.id) && bounded(&item.label, 500) && ids.insert(item.id.as_str())
        })
}

fn valid_choices(options: &[Choice], minimum: usize, maximum: usize) -> bool {
    let mut ids = HashSet::new();
    (minimum..=maximum).contains(&options.len())
        && options.iter().all(|option| {
            identifier(&option.id)
                && bounded(&option.label, 500)
                && option.other.is_none()
                && option.exclusive.is_none()
                && ids.insert(option.id.as_str())
        })
}

pub fn validate_question(q: &Question) -> Result<(), Error> {
    let advanced = q.rows.is_some()
        || q.columns.is_some()
        || q.matrix_mode.is_some()
        || q.items.is_some()
        || q.total.is_some();
    let legacy = q.min.is_some()
        || q.max.is_some()
        || q.max_length.is_some()
        || q.preset.is_some()
        || q.labels.is_some()
        || q.min_selections.is_some()
        || q.max_selections.is_some()
        || q.presentation.is_some();
    let valid = match q.kind.as_str() {
        "ranking" => {
            q.options.as_ref().is_some_and(|v| valid_choices(v, 2, 50)) && !advanced && !legacy
        }
        "matrix" => {
            q.rows.as_ref().is_some_and(|v| valid_items(v, 1, 50))
                && q.columns.as_ref().is_some_and(|v| valid_choices(v, 2, 20))
                && q.matrix_mode.is_some()
                && q.rows
                    .as_ref()
                    .zip(q.columns.as_ref())
                    .is_some_and(|(rows, columns)| rows.len() * columns.len() <= 200)
                && q.options.is_none()
                && q.items.is_none()
                && q.total.is_none()
                && !legacy
        }
        "constant_sum" => {
            q.items.as_ref().is_some_and(|v| valid_items(v, 2, 50))
                && matches!(q.total, Some(1..=1_000_000))
                && q.options.is_none()
                && q.rows.is_none()
                && q.columns.is_none()
                && q.matrix_mode.is_none()
                && !legacy
        }
        _ if advanced => false,
        _ => return Ok(()),
    };
    if valid {
        Ok(())
    } else {
        Err(invalid("invalid advanced question configuration"))
    }
}

pub fn validate_answer(q: &Question, answer: &Value) -> bool {
    match q.kind.as_str() {
        "ranking" => {
            let Some(values) = answer.as_array() else {
                return false;
            };
            let Some(options) = &q.options else {
                return false;
            };
            let Some(ids) = values.iter().map(Value::as_str).collect::<Option<Vec<_>>>() else {
                return false;
            };
            let unique = ids.iter().copied().collect::<HashSet<_>>();
            ids.len() == options.len()
                && unique.len() == ids.len()
                && ids
                    .iter()
                    .all(|id| options.iter().any(|option| option.id == *id))
        }
        "matrix" => {
            let Some(values) = answer.as_object() else {
                return false;
            };
            let (Some(rows), Some(columns), Some(mode)) = (&q.rows, &q.columns, &q.matrix_mode)
            else {
                return false;
            };
            if values.is_empty()
                || (q.required && values.len() != rows.len())
                || values
                    .keys()
                    .any(|id| !rows.iter().any(|row| row.id == *id))
            {
                return false;
            }
            values.values().all(|value| match mode {
                MatrixMode::Single => value
                    .as_str()
                    .is_some_and(|id| columns.iter().any(|column| column.id == id)),
                MatrixMode::Multiple => value.as_array().is_some_and(|selected| {
                    let Some(ids) = selected
                        .iter()
                        .map(Value::as_str)
                        .collect::<Option<Vec<_>>>()
                    else {
                        return false;
                    };
                    !ids.is_empty()
                        && ids.iter().copied().collect::<HashSet<_>>().len() == ids.len()
                        && ids
                            .iter()
                            .all(|id| columns.iter().any(|column| column.id == *id))
                }),
            })
        }
        "constant_sum" => {
            let Some(values) = answer.as_object() else {
                return false;
            };
            let (Some(items), Some(total)) = (&q.items, q.total) else {
                return false;
            };
            values.len() == items.len()
                && values
                    .keys()
                    .all(|id| items.iter().any(|item| item.id == *id))
                && values
                    .values()
                    .all(|value| value.as_u64().is_some_and(|n| n <= total))
                && values.values().filter_map(Value::as_u64).sum::<u64>() == total
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        normalized_answers, schema_version, survey_schema_version, validate_draft, DraftInput,
    };
    use serde_json::json;

    #[test]
    fn shared_cases_match_authoritative_validator() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../contracts/advanced-question-cases.json"))
                .unwrap();
        for name in ["ranking", "matrixSingle", "matrixMultiple", "constantSum"] {
            let case = &fixture[name];
            let question: Question = serde_json::from_value(case["question"].clone()).unwrap();
            validate_question(&question).unwrap();
            for answer in case["valid"].as_array().unwrap() {
                assert!(validate_answer(&question, answer), "{name}: {answer}");
            }
            for answer in case["invalid"].as_array().unwrap() {
                assert!(!validate_answer(&question, answer), "{name}: {answer}");
            }
        }
    }

    #[test]
    fn v5_configuration_is_bounded_and_legacy_versions_remain_distinct() {
        let draft: DraftInput =
            serde_json::from_str(include_str!("../../contracts/advanced-survey.example.json"))
                .unwrap();
        validate_draft(&draft).unwrap();
        assert_eq!(schema_version(&draft.questions), 5);
        assert_eq!(survey_schema_version(&draft.questions, None), 5);
        let base = serde_json::to_value(&draft.questions[1]).unwrap();
        for replacement in [
            json!({"id":"matrix","type":"matrix","label":"M","matrixMode":"single","rows":[{"id":"r","label":"R"},{"id":"r","label":"Again"}],"columns":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}),
            json!({"id":"matrix","type":"matrix","label":"M","matrixMode":"single","rows":(0..11).map(|n|json!({"id":format!("r{n}"),"label":"R"})).collect::<Vec<_>>(),"columns":(0..19).map(|n|json!({"id":format!("c{n}"),"label":"C"})).collect::<Vec<_>>() }),
            json!({"id":"rank","type":"ranking","label":"R","options":[{"id":"a","label":"A","exclusive":true},{"id":"b","label":"B"}]}),
            json!({"id":"sum","type":"constant_sum","label":"S","total":100,"min":0,"items":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}),
        ] {
            let question: Question = serde_json::from_value(replacement).unwrap();
            assert!(validate_question(&question).is_err(), "{base}");
        }
    }

    #[test]
    fn advanced_objects_count_as_answered_for_visibility() {
        let draft: DraftInput = serde_json::from_value(json!({"title":"Advanced condition","questions":[
          {"id":"matrix","type":"matrix","label":"M","matrixMode":"single","rows":[{"id":"r","label":"R"}],"columns":[{"id":"a","label":"A"},{"id":"b","label":"B"}]},
          {"id":"follow","type":"text","label":"Why","maxLength":100,"required":true,"visibleWhen":{"questionId":"matrix","operator":"answered"}}
        ]})).unwrap();
        validate_draft(&draft).unwrap();
        assert!(normalized_answers(
            &draft.questions,
            json!({"matrix":{"r":"a"}}).as_object().unwrap()
        )
        .is_err());
        assert!(normalized_answers(
            &draft.questions,
            json!({"matrix":{"r":"a"},"follow":"ok"})
                .as_object()
                .unwrap()
        )
        .is_ok());
    }
}
