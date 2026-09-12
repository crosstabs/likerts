//! Schema-v3 choice semantics. Presentation never changes the stored answer type.
use crate::{invalid, Error, Presentation, Question};
use serde_json::Value;
use std::collections::HashSet;

pub fn validate_question_features(q: &Question) -> Result<(), Error> {
    if let Some(presentation) = &q.presentation {
        match presentation {
            Presentation::Stars
                if q.kind == "scale"
                    && q.min == Some(1.0)
                    && q.max
                        .is_some_and(|n| n.fract() == 0.0 && (1.0..=10.0).contains(&n))
                    && q.preset.is_none() => {}
            Presentation::Dropdown if q.kind == "single_choice" => {}
            _ => return Err(invalid("invalid question presentation")),
        }
    }
    if let Some(options) = &q.options {
        if options.iter().filter(|o| o.other.is_some()).count() > 1
            || options.iter().filter(|o| o.exclusive.is_some()).count() > 1
            || options.iter().any(|o| {
                o.exclusive == Some(false)
                    || (o.other.is_some() && o.exclusive.is_some())
                    || o.other
                        .as_ref()
                        .is_some_and(|other| !(1..=10000).contains(&other.max_length))
                    || (q.preset.is_some() && (o.other.is_some() || o.exclusive.is_some()))
            })
        {
            return Err(invalid("invalid Other or exclusive choice configuration"));
        }
    }
    Ok(())
}

pub fn validate_choice_answer(q: &Question, answer: &Value) -> bool {
    let Some(options) = &q.options else {
        return false;
    };
    let has_other = options.iter().any(|option| option.other.is_some());
    let (selected, other_text): (Vec<&str>, Option<&serde_json::Map<String, Value>>) = if has_other
    {
        let Some(object) = answer.as_object() else {
            return false;
        };
        if object.len() != 2 {
            return false;
        }
        let Some(values) = object.get("selected").and_then(Value::as_array) else {
            return false;
        };
        let Some(text) = object.get("otherText").and_then(Value::as_object) else {
            return false;
        };
        let Some(ids) = values.iter().map(Value::as_str).collect::<Option<Vec<_>>>() else {
            return false;
        };
        (ids, Some(text))
    } else if q.kind == "single_choice" {
        let Some(id) = answer.as_str() else {
            return false;
        };
        (vec![id], None)
    } else {
        let Some(values) = answer.as_array() else {
            return false;
        };
        let Some(ids) = values.iter().map(Value::as_str).collect::<Option<Vec<_>>>() else {
            return false;
        };
        (ids, None)
    };
    let mut seen = HashSet::new();
    if selected
        .iter()
        .any(|id| !seen.insert(*id) || !options.iter().any(|o| o.id == *id))
    {
        return false;
    }
    let exclusive = selected.iter().any(|id| {
        options
            .iter()
            .any(|o| o.id == *id && o.exclusive == Some(true))
    });
    if q.kind == "single_choice" {
        if selected.len() != 1 {
            return false;
        }
    } else if exclusive {
        // Selecting None is a complete answer even when ordinary choices have a minimum.
        if selected.len() != 1 || q.max_selections == Some(0) {
            return false;
        }
    } else if selected.len() < q.min_selections.unwrap_or(0).max(usize::from(q.required))
        || selected.len() > q.max_selections.unwrap_or(options.len())
    {
        return false;
    }
    if let Some(text) = other_text {
        let expected = options
            .iter()
            .filter(|o| o.other.is_some() && selected.contains(&o.id.as_str()))
            .collect::<Vec<_>>();
        if text.len() != expected.len() {
            return false;
        }
        if expected.iter().any(|option| {
            !text
                .get(&option.id)
                .and_then(Value::as_str)
                .is_some_and(|s| {
                    !s.trim().is_empty()
                        && s.chars().count() <= option.other.as_ref().unwrap().max_length
                })
        }) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn question() -> Question {
        serde_json::from_value(json!({"id":"reason","label":"Reason","type":"multiple_choice","required":true,"minSelections":2,"maxSelections":3,"options":[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"other","label":"Other","other":{"maxLength":3}},{"id":"none","label":"None","exclusive":true}]})).unwrap()
    }

    #[test]
    fn structured_other_has_exact_selected_text_and_unicode_bounds() {
        let q = question();
        assert!(validate_question_features(&q).is_ok());
        for value in [
            json!({"selected":["a","other"],"otherText":{"other":"猫猫猫"}}),
            json!({"selected":["a","b"],"otherText":{}}),
            json!({"selected":["none"],"otherText":{}}),
        ] {
            assert!(validate_choice_answer(&q, &value), "{value}");
        }
        for value in [
            json!(["a", "other"]),
            json!({"selected":["a","other"],"otherText":{}}),
            json!({"selected":["a","other"],"otherText":{"other":"    "}}),
            json!({"selected":["a","other"],"otherText":{"other":"猫猫猫猫"}}),
            json!({"selected":["a","b"],"otherText":{"other":"x"}}),
            json!({"selected":["none","a"],"otherText":{}}),
            json!({"selected":["a","a"],"otherText":{}}),
            json!({"selected":["missing","a"],"otherText":{}}),
            json!({"selected":["a"],"otherText":{}}),
            json!({"selected":["none"],"otherText":{},"extra":true}),
        ] {
            assert!(!validate_choice_answer(&q, &value), "{value}");
        }
    }

    #[test]
    fn legacy_and_presentation_answers_keep_their_types() {
        let mut q = question();
        q.options.as_mut().unwrap().retain(|o| o.other.is_none());
        assert!(validate_choice_answer(&q, &json!(["a", "b"])));
        assert!(validate_choice_answer(&q, &json!(["none"])));
        assert!(!validate_choice_answer(&q, &json!(["none", "a"])));
        q.kind = "single_choice".into();
        q.min_selections = None;
        q.max_selections = None;
        q.presentation = Some(Presentation::Dropdown);
        assert!(validate_question_features(&q).is_ok());
        assert!(validate_choice_answer(&q, &json!("a")));
        assert!(!validate_choice_answer(
            &q,
            &json!({"selected":["a"],"otherText":{}})
        ));
    }

    #[test]
    fn bounded_features_reject_ambiguous_configuration() {
        let base = serde_json::to_value(question()).unwrap();
        for (path, value) in [
            ("/options/2/other/maxLength", json!(0)),
            ("/options/2/other/maxLength", json!(10001)),
            ("/options/3/exclusive", json!(false)),
        ] {
            let mut invalid = base.clone();
            *invalid.pointer_mut(path).unwrap() = value;
            let q: Question = serde_json::from_value(invalid).unwrap();
            assert!(validate_question_features(&q).is_err());
        }
        let mut q = question();
        q.options.as_mut().unwrap()[2].exclusive = Some(true);
        assert!(validate_question_features(&q).is_err());
        let mut q = question();
        q.presentation = Some(Presentation::Stars);
        assert!(validate_question_features(&q).is_err());
        q.kind = "scale".into();
        q.options = None;
        q.min = Some(1.0);
        q.max = Some(5.0);
        assert!(validate_question_features(&q).is_ok());
        q.max = Some(11.0);
        assert!(validate_question_features(&q).is_err());
    }

    #[test]
    fn shared_choice_fixture_matches_the_authoritative_validator() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../contracts/choice-features.json")).unwrap();
        let q: Question = serde_json::from_value(fixture["question"].clone()).unwrap();
        for value in fixture["valid"].as_array().unwrap() {
            assert!(validate_choice_answer(&q, value), "{value}");
        }
        for value in fixture["invalid"].as_array().unwrap() {
            assert!(!validate_choice_answer(&q, value), "{value}");
        }
    }
}
