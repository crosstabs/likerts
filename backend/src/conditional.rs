use crate::{invalid, Error, Question, VisibilityCondition, VisibilityOperator};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

pub fn validate_visibility(questions: &[Question]) -> Result<(), Error> {
    let by_id: HashMap<&str, &Question> = questions.iter().map(|q| (q.id.as_str(), q)).collect();
    for question in questions {
        let Some(condition) = &question.visible_when else {
            continue;
        };
        let source = by_id
            .get(condition.question_id.as_str())
            .copied()
            .ok_or_else(|| invalid("visibleWhen references an unknown question"))?;
        if source.id == question.id {
            return Err(invalid("visibleWhen cannot reference its own question"));
        }
        validate_condition(source, condition)?;
    }
    let mut states = HashMap::new();
    for question in questions {
        visit(question, &by_id, &mut states)?;
    }
    Ok(())
}

fn visit(
    question: &Question,
    by_id: &HashMap<&str, &Question>,
    states: &mut HashMap<String, u8>,
) -> Result<(), Error> {
    match states.get(&question.id) {
        Some(1) => return Err(invalid("visibleWhen dependency cycle")),
        Some(2) => return Ok(()),
        _ => {}
    }
    states.insert(question.id.clone(), 1);
    if let Some(condition) = &question.visible_when {
        visit(by_id[condition.question_id.as_str()], by_id, states)?;
    }
    states.insert(question.id.clone(), 2);
    Ok(())
}

pub(crate) fn validate_condition(
    source: &Question,
    condition: &VisibilityCondition,
) -> Result<(), Error> {
    use VisibilityOperator::*;
    match condition.operator {
        Answered | NotAnswered if condition.value.is_none() => Ok(()),
        Equals | NotEquals if source.kind == "multiple_choice" => {
            Err(invalid("equals operators do not support multiple_choice"))
        }
        Includes | NotIncludes if source.kind != "multiple_choice" => {
            Err(invalid("includes operators require multiple_choice"))
        }
        Includes | NotIncludes => {
            let value = condition.value.as_ref().and_then(Value::as_str);
            if value.is_some_and(|value| {
                source
                    .options
                    .as_ref()
                    .is_some_and(|options| options.iter().any(|option| option.id == value))
            }) {
                Ok(())
            } else {
                Err(invalid("visibleWhen choice value is invalid"))
            }
        }
        Equals | NotEquals => {
            let valid = match source.kind.as_str() {
                "single_choice" => condition
                    .value
                    .as_ref()
                    .and_then(Value::as_str)
                    .is_some_and(|value| {
                        source
                            .options
                            .as_ref()
                            .is_some_and(|options| options.iter().any(|option| option.id == value))
                    }),
                "text" | "date" => condition.value.as_ref().is_some_and(Value::is_string),
                "number" => condition
                    .value
                    .as_ref()
                    .and_then(Value::as_f64)
                    .is_some_and(f64::is_finite),
                "scale" => condition
                    .value
                    .as_ref()
                    .and_then(Value::as_f64)
                    .is_some_and(|value| {
                        value.is_finite()
                            && value.fract() == 0.0
                            && source.min.is_none_or(|min| value >= min)
                            && source.max.is_none_or(|max| value <= max)
                    }),
                _ => false,
            };
            if valid {
                Ok(())
            } else {
                Err(invalid("visibleWhen comparison value is invalid"))
            }
        }
        _ => Err(invalid("visibleWhen value is invalid for operator")),
    }
}

fn selected(answer: &Value) -> Option<Vec<&str>> {
    if let Some(value) = answer.as_str() {
        return Some(vec![value]);
    }
    let values = answer
        .as_array()
        .or_else(|| answer.get("selected").and_then(Value::as_array))?;
    values.iter().map(Value::as_str).collect()
}

fn answered(answer: Option<&Value>) -> bool {
    answer.is_some_and(|value| match value {
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(values) => value.get("selected").map_or(!values.is_empty(), |_| {
            selected(value).is_some_and(|values| !values.is_empty())
        }),
        Value::Number(_) => true,
        _ => false,
    })
}

pub(crate) fn matches(condition: &VisibilityCondition, answer: Option<&Value>) -> bool {
    use VisibilityOperator::*;
    match condition.operator {
        Answered => answered(answer),
        NotAnswered => !answered(answer),
        Equals | NotEquals => {
            let Some(answer) = answer else { return false };
            let actual = selected(answer)
                .and_then(|values| (values.len() == 1).then_some(Value::String(values[0].into())))
                .unwrap_or_else(|| answer.clone());
            let equal = condition
                .value
                .as_ref()
                .is_some_and(|expected| *expected == actual);
            if matches!(condition.operator, Equals) {
                equal
            } else {
                !equal
            }
        }
        Includes | NotIncludes => {
            let Some(answer) = answer else { return false };
            let included = condition
                .value
                .as_ref()
                .and_then(Value::as_str)
                .is_some_and(|expected| {
                    selected(answer).is_some_and(|values| values.contains(&expected))
                });
            if matches!(condition.operator, Includes) {
                included
            } else {
                !included
            }
        }
    }
}

fn visibility(
    question: &Question,
    by_id: &HashMap<&str, &Question>,
    answers: &Map<String, Value>,
    memo: &mut HashMap<String, bool>,
    active: &mut HashSet<String>,
) -> Result<bool, Error> {
    if let Some(value) = memo.get(&question.id) {
        return Ok(*value);
    }
    if !active.insert(question.id.clone()) {
        return Err(invalid("visibleWhen dependency cycle"));
    }
    let result = if let Some(condition) = &question.visible_when {
        let source = by_id
            .get(condition.question_id.as_str())
            .copied()
            .ok_or_else(|| invalid("visibleWhen references an unknown question"))?;
        let source_answer = visibility(source, by_id, answers, memo, active)?
            .then(|| answers.get(&source.id))
            .flatten();
        matches(condition, source_answer)
    } else {
        true
    };
    active.remove(&question.id);
    memo.insert(question.id.clone(), result);
    Ok(result)
}

pub fn is_visible(
    questions: &[Question],
    answers: &Map<String, Value>,
    question_id: &str,
) -> Result<bool, Error> {
    let by_id: HashMap<&str, &Question> = questions.iter().map(|q| (q.id.as_str(), q)).collect();
    let question = by_id
        .get(question_id)
        .copied()
        .ok_or_else(|| invalid("unknown question"))?;
    visibility(
        question,
        &by_id,
        answers,
        &mut HashMap::new(),
        &mut HashSet::new(),
    )
}

pub fn visible_answers(
    questions: &[Question],
    answers: &Map<String, Value>,
) -> Result<Map<String, Value>, Error> {
    let by_id: HashMap<&str, &Question> = questions.iter().map(|q| (q.id.as_str(), q)).collect();
    let mut memo = HashMap::new();
    let mut result = Map::new();
    for question in questions {
        if visibility(question, &by_id, answers, &mut memo, &mut HashSet::new())? {
            if let Some(answer) = answers.get(&question.id) {
                result.insert(question.id.clone(), answer.clone());
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::{normalized_answers, schema_version, validate_draft, DraftInput};
    use serde_json::json;

    fn draft() -> DraftInput {
        serde_json::from_value(json!({
            "title":"Conditional",
            "questions":[
                {"id":"return","label":"Return?","type":"single_choice","required":true,"options":[{"id":"yes","label":"Yes"},{"id":"no","label":"No"}]},
                {"id":"reason","label":"Reason","type":"text","required":true,"maxLength":100,"visibleWhen":{"questionId":"return","operator":"equals","value":"no"}},
                {"id":"detail","label":"Detail","type":"text","maxLength":100,"visibleWhen":{"questionId":"reason","operator":"answered"}}
            ]
        })).unwrap()
    }

    #[test]
    fn conditional_schema_is_v3_and_hidden_answers_are_discarded() {
        let draft = draft();
        validate_draft(&draft).unwrap();
        assert_eq!(schema_version(&draft.questions), 3);
        let answers = json!({"return":"yes","reason":"stale","detail":"stale"});
        let normalized =
            normalized_answers(&draft.questions, answers.as_object().unwrap()).unwrap();
        assert_eq!(
            normalized,
            json!({"return":"yes"}).as_object().unwrap().clone()
        );
    }

    #[test]
    fn requiredness_applies_only_while_visible() {
        let draft = draft();
        assert!(normalized_answers(
            &draft.questions,
            json!({"return":"yes"}).as_object().unwrap()
        )
        .is_ok());
        assert!(normalized_answers(
            &draft.questions,
            json!({"return":"no"}).as_object().unwrap()
        )
        .is_err());
        let visible = normalized_answers(
            &draft.questions,
            json!({"return":"no","reason":"late","detail":"explain"})
                .as_object()
                .unwrap(),
        )
        .unwrap();
        assert!(visible.contains_key("detail"));
        let whitespace = normalized_answers(
            &draft.questions,
            json!({"return":"no","reason":"   ","detail":"must be discarded"})
                .as_object()
                .unwrap(),
        );
        assert!(whitespace.is_err());
    }

    #[test]
    fn invalid_references_cycles_operators_and_values_are_rejected() {
        for mutation in [
            json!({"questionId":"missing","operator":"answered"}),
            json!({"questionId":"return","operator":"includes","value":"yes"}),
            json!({"questionId":"return","operator":"equals","value":"missing"}),
            json!({"questionId":"return","operator":"answered","value":"yes"}),
        ] {
            let mut value = serde_json::to_value(draft()).unwrap();
            value["questions"][1]["visibleWhen"] = mutation;
            assert!(validate_draft(&serde_json::from_value(value).unwrap()).is_err());
        }
        let mut value = serde_json::to_value(draft()).unwrap();
        value["questions"][0]["visibleWhen"] = json!({"questionId":"detail","operator":"answered"});
        assert!(validate_draft(&serde_json::from_value(value).unwrap()).is_err());
        let mut value = serde_json::to_value(draft()).unwrap();
        value["questions"][1]["visibleWhen"]["operator"] = json!("unsupported");
        assert!(serde_json::from_value::<DraftInput>(value).is_err());
    }
}
