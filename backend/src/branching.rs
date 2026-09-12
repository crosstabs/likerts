use crate::{bounded, conditional, identifier, invalid, Error, Question, VisibilityCondition};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

pub const MAX_SURVEY_PAGES: usize = 50;
pub const MAX_PAGE_BRANCHES: usize = 20;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PageBranch {
    pub when: VisibilityCondition,
    pub go_to_page_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SurveyPage {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub question_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub branches: Vec<PageBranch>,
}

pub fn validate_pages(questions: &[Question], pages: Option<&[SurveyPage]>) -> Result<(), Error> {
    let Some(pages) = pages else { return Ok(()) };
    if pages.is_empty() || pages.len() > MAX_SURVEY_PAGES {
        return Err(invalid("pages requires 1 to 50 pages"));
    }
    let questions_by_id: HashMap<&str, &Question> = questions
        .iter()
        .map(|question| (question.id.as_str(), question))
        .collect();
    let mut page_ids = HashMap::new();
    let mut question_pages = HashMap::new();
    for (page_index, page) in pages.iter().enumerate() {
        if !identifier(&page.id)
            || page_ids.insert(page.id.as_str(), page_index).is_some()
            || page
                .title
                .as_ref()
                .is_some_and(|title| !bounded(title, 200))
            || page.question_ids.is_empty()
            || page.question_ids.len() > 100
            || page.branches.len() > MAX_PAGE_BRANCHES
        {
            return Err(invalid("invalid page definition"));
        }
        for question_id in &page.question_ids {
            if !questions_by_id.contains_key(question_id.as_str())
                || question_pages
                    .insert(question_id.as_str(), page_index)
                    .is_some()
            {
                return Err(invalid("pages contain an unknown or duplicate question"));
            }
        }
    }
    if question_pages.len() != questions.len() {
        return Err(invalid("every question must occur on exactly one page"));
    }

    for question in questions {
        if let Some(condition) = &question.visible_when {
            if question_pages[condition.question_id.as_str()] > question_pages[question.id.as_str()]
            {
                return Err(invalid(
                    "paged question visibility cannot depend on a future page",
                ));
            }
        }
    }
    for (page_index, page) in pages.iter().enumerate() {
        let mut conditions = HashSet::new();
        for branch in &page.branches {
            let source = questions_by_id
                .get(branch.when.question_id.as_str())
                .copied()
                .ok_or_else(|| invalid("branch references an unknown question"))?;
            conditional::validate_condition(source, &branch.when)?;
            let destination = page_ids
                .get(branch.go_to_page_id.as_str())
                .copied()
                .ok_or_else(|| invalid("branch references an unknown page"))?;
            if question_pages[source.id.as_str()] > page_index {
                return Err(invalid("branch cannot depend on a future page"));
            }
            if destination <= page_index {
                return Err(invalid("branch destination must be strictly forward"));
            }
            let condition = serde_json::to_string(&branch.when).map_err(|_| Error::Internal)?;
            if !conditions.insert(condition) {
                return Err(invalid("duplicate branch condition"));
            }
        }
    }
    Ok(())
}

pub fn reached_page_indices(
    questions: &[Question],
    pages: Option<&[SurveyPage]>,
    answers: &Map<String, Value>,
) -> Result<Vec<usize>, Error> {
    let Some(pages) = pages else {
        return Ok(vec![0]);
    };
    validate_pages(questions, Some(pages))?;
    let page_ids: HashMap<&str, usize> = pages
        .iter()
        .enumerate()
        .map(|(index, page)| (page.id.as_str(), index))
        .collect();
    let visible = conditional::visible_answers(questions, answers)?;
    let mut reached = Vec::with_capacity(pages.len());
    let mut available = HashSet::new();
    let mut current = 0;
    while current < pages.len() {
        reached.push(current);
        available.extend(pages[current].question_ids.iter().map(String::as_str));
        let destination = pages[current].branches.iter().find_map(|branch| {
            let answer = available
                .contains(branch.when.question_id.as_str())
                .then(|| visible.get(&branch.when.question_id))
                .flatten();
            conditional::matches(&branch.when, answer)
                .then(|| page_ids[branch.go_to_page_id.as_str()])
        });
        current = destination.unwrap_or(current + 1);
    }
    Ok(reached)
}

/// Removes answers hidden by conditional visibility or belonging to pages outside the
/// route determined by the remaining answers. Removal is monotonic and therefore bounded.
pub fn routed_answers(
    questions: &[Question],
    pages: Option<&[SurveyPage]>,
    answers: &Map<String, Value>,
) -> Result<Map<String, Value>, Error> {
    let mut result = conditional::visible_answers(questions, answers)?;
    let Some(pages) = pages else {
        return Ok(result);
    };
    for _ in 0..=questions.len() {
        let reached = reached_page_indices(questions, Some(pages), &result)?;
        let reached: HashSet<&str> = reached
            .iter()
            .flat_map(|index| pages[*index].question_ids.iter().map(String::as_str))
            .collect();
        let page_filtered: Map<String, Value> = result
            .into_iter()
            .filter(|(id, _)| reached.contains(id.as_str()))
            .collect();
        let visible = conditional::visible_answers(questions, &page_filtered)?;
        if visible == page_filtered {
            return Ok(visible);
        }
        result = visible;
    }
    Err(Error::Internal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{normalized_answers_for_pages, DraftInput};
    use serde_json::json;

    fn draft() -> DraftInput {
        serde_json::from_str(include_str!(
            "../../contracts/branching-survey.example.json"
        ))
        .unwrap()
    }

    #[test]
    fn routes_forward_and_discards_answers_from_skipped_pages() {
        let draft = draft();
        validate_pages(&draft.questions, draft.pages.as_deref()).unwrap();
        let answers = json!({"return":"no","highlight":"stale praise","problem":"Long wait","followUp":"yes"});
        assert_eq!(
            reached_page_indices(
                &draft.questions,
                draft.pages.as_deref(),
                answers.as_object().unwrap()
            )
            .unwrap(),
            vec![0, 2, 3]
        );
        assert_eq!(
            routed_answers(
                &draft.questions,
                draft.pages.as_deref(),
                answers.as_object().unwrap()
            )
            .unwrap(),
            json!({"return":"no","problem":"Long wait","followUp":"yes"})
                .as_object()
                .unwrap()
                .clone()
        );
    }

    #[test]
    fn answer_change_recomputes_route_and_prunes_the_old_branch() {
        let draft = draft();
        let answers = json!({"return":"yes","highlight":"Friendly staff","problem":"stale problem","followUp":"no"});
        assert_eq!(
            reached_page_indices(
                &draft.questions,
                draft.pages.as_deref(),
                answers.as_object().unwrap()
            )
            .unwrap(),
            vec![0, 1, 3]
        );
        assert_eq!(
            routed_answers(
                &draft.questions,
                draft.pages.as_deref(),
                answers.as_object().unwrap()
            )
            .unwrap(),
            json!({"return":"yes","highlight":"Friendly staff","followUp":"no"})
                .as_object()
                .unwrap()
                .clone()
        );
    }

    #[test]
    fn requiredness_applies_only_on_the_reached_route() {
        let draft = draft();
        assert!(normalized_answers_for_pages(
            &draft.questions,
            draft.pages.as_deref(),
            json!({"return":"no","problem":"Long wait"})
                .as_object()
                .unwrap()
        )
        .is_ok());
        assert!(normalized_answers_for_pages(
            &draft.questions,
            draft.pages.as_deref(),
            json!({"return":"no"}).as_object().unwrap()
        )
        .is_err());
        assert!(normalized_answers_for_pages(
            &draft.questions,
            draft.pages.as_deref(),
            json!({"return":"yes","highlight":"Friendly staff"})
                .as_object()
                .unwrap()
        )
        .is_ok());
    }

    #[test]
    fn invalid_page_partitions_and_routes_are_rejected() {
        let draft = draft();
        for destination in ["missing", "experience", "praise"] {
            let mut value = serde_json::to_value(&draft).unwrap();
            value["pages"][2]["branches"] = json!([{
                "when":{"questionId":"problem","operator":"answered"},
                "goToPageId":destination
            }]);
            let invalid: DraftInput = serde_json::from_value(value).unwrap();
            assert!(validate_pages(&invalid.questions, invalid.pages.as_deref()).is_err());
        }
        let mut value = serde_json::to_value(&draft).unwrap();
        value["pages"][1]["questionIds"] = json!(["highlight", "problem"]);
        let invalid: DraftInput = serde_json::from_value(value).unwrap();
        assert!(validate_pages(&invalid.questions, invalid.pages.as_deref()).is_err());
    }
}
