use crate::{Question, Response};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

pub const DEFAULT_MINIMUM_GROUP_SIZE: u16 = 3;
pub const MAX_ANALYSIS_RESPONSES: usize = 50_000;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResponseAnalysisInput {
    pub collection_id: Option<String>,
    pub accepted_from: Option<DateTime<Utc>>,
    pub accepted_to: Option<DateTime<Utc>>,
    pub minimum_group_size: Option<u16>,
}

impl ResponseAnalysisInput {
    pub fn minimum_group_size(&self) -> Result<u16, crate::Error> {
        let value = self
            .minimum_group_size
            .unwrap_or(DEFAULT_MINIMUM_GROUP_SIZE);
        if !(3..=100).contains(&value) {
            return Err(crate::Error::Invalid(
                "minimumGroupSize must be between 3 and 100".into(),
            ));
        }
        if matches!((self.accepted_from, self.accepted_to), (Some(from), Some(to)) if from >= to) {
            return Err(crate::Error::Invalid(
                "acceptedFrom must be earlier than acceptedTo".into(),
            ));
        }
        Ok(value)
    }
}

#[derive(Clone, Debug)]
pub struct ResponseSchema {
    pub collection_id: String,
    pub survey_id: String,
    pub version: u64,
    pub title: String,
    pub questions: Vec<Question>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacySummary {
    pub minimum_group_size: u16,
    pub small_cells_suppressed: bool,
    pub text_answers_included: bool,
    pub respondent_metadata_included: bool,
    pub note: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionPoint {
    pub value: String,
    pub label: String,
    pub count: u64,
    pub percentage: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NumericSummary {
    pub mean: f64,
    pub median: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAnalysis {
    pub question_id: String,
    pub label: String,
    pub kind: String,
    pub answered_count: u64,
    pub missing_count: u64,
    pub suppressed_value_count: u64,
    pub numeric: Option<NumericSummary>,
    pub distribution: Vec<DistributionPoint>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionAnalysis {
    pub collection_id: String,
    pub survey_id: String,
    pub version: u64,
    pub title: String,
    pub response_count: u64,
    pub suppressed: bool,
    pub questions: Vec<QuestionAnalysis>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: &'static str,
    pub title: String,
    pub detail: String,
    pub collection_id: Option<String>,
    pub question_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Visualization {
    pub id: String,
    pub collection_id: String,
    pub question_id: String,
    pub title: String,
    pub kind: &'static str,
    pub x_field: &'static str,
    pub y_field: &'static str,
    pub data: Vec<DistributionPoint>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseAnalysis {
    pub generated_at: DateTime<Utc>,
    pub response_count: u64,
    pub collection_count: u64,
    pub privacy: PrivacySummary,
    pub collections: Vec<CollectionAnalysis>,
    pub findings: Vec<Finding>,
    pub visualizations: Vec<Visualization>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseAggregate {
    pub generated_at: DateTime<Utc>,
    pub response_count: u64,
    pub collection_count: u64,
    pub privacy: PrivacySummary,
    pub collections: Vec<CollectionAnalysis>,
}

impl ResponseAnalysis {
    pub fn into_aggregate(self) -> ResponseAggregate {
        ResponseAggregate {
            generated_at: self.generated_at,
            response_count: self.response_count,
            collection_count: self.collection_count,
            privacy: self.privacy,
            collections: self.collections,
        }
    }
}

fn rounded(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn value_key(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn labels(question: &Question) -> HashMap<String, String> {
    let mut result = question.labels.clone().unwrap_or_default();
    for option in question.options.as_deref().unwrap_or_default() {
        result.insert(option.id.clone(), option.label.clone());
    }
    result
}

fn distribution(
    values: &[&Value],
    answered_count: usize,
    minimum_group_size: usize,
    value_labels: &HashMap<String, String>,
) -> (Vec<DistributionPoint>, u64) {
    let mut counts = BTreeMap::<String, u64>::new();
    for value in values {
        match value {
            Value::Array(items) => {
                for item in items {
                    if let Some(key) = value_key(item) {
                        *counts.entry(key).or_default() += 1;
                    }
                }
            }
            other => {
                if let Some(key) = value_key(other) {
                    *counts.entry(key).or_default() += 1;
                }
            }
        }
    }
    let mut suppressed = 0;
    let mut points = counts
        .into_iter()
        .filter_map(|(value, count)| {
            if count < minimum_group_size as u64 {
                suppressed += count;
                return None;
            }
            Some(DistributionPoint {
                label: value_labels
                    .get(&value)
                    .cloned()
                    .unwrap_or_else(|| value.clone()),
                value,
                count,
                percentage: rounded(count as f64 * 100.0 / answered_count.max(1) as f64),
            })
        })
        .collect::<Vec<_>>();
    points.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
    (points, suppressed)
}

fn numeric_summary(values: &[&Value]) -> Option<NumericSummary> {
    let mut numbers = values
        .iter()
        .filter_map(|value| value.as_f64())
        .collect::<Vec<_>>();
    if numbers.is_empty() {
        return None;
    }
    numbers.sort_by(f64::total_cmp);
    let middle = numbers.len() / 2;
    let median = if numbers.len() % 2 == 0 {
        (numbers[middle - 1] + numbers[middle]) / 2.0
    } else {
        numbers[middle]
    };
    Some(NumericSummary {
        mean: rounded(numbers.iter().sum::<f64>() / numbers.len() as f64),
        median: rounded(median),
    })
}

fn analyze_question(
    question: &Question,
    answers: &[&Map<String, Value>],
    minimum_group_size: usize,
) -> QuestionAnalysis {
    let values = answers
        .iter()
        .filter_map(|answer| answer.get(&question.id))
        .collect::<Vec<_>>();
    let answered_count = values.len();
    let missing_count = answers.len().saturating_sub(answered_count);
    let sensitive_text = matches!(
        question.kind.as_str(),
        "text" | "date" | "ranking" | "matrix" | "constant_sum"
    );
    let value_labels = labels(question);
    let (distribution, suppressed_value_count) = if sensitive_text {
        (Vec::new(), 0)
    } else {
        distribution(&values, answered_count, minimum_group_size, &value_labels)
    };
    let numeric = if matches!(question.kind.as_str(), "scale" | "number")
        && answered_count >= minimum_group_size
    {
        numeric_summary(&values)
    } else {
        None
    };
    let note = match question.kind.as_str() {
        "text" => Some("Free-text values are excluded from privacy-safe analysis.".into()),
        "date" => Some("Exact dates are excluded from privacy-safe analysis.".into()),
        "ranking" | "matrix" | "constant_sum" => {
            Some("Structured values are counted as answered but are not returned verbatim.".into())
        }
        _ if suppressed_value_count > 0 => Some(format!(
            "{suppressed_value_count} answers belong to cells smaller than the privacy threshold."
        )),
        _ => None,
    };
    QuestionAnalysis {
        question_id: question.id.clone(),
        label: question.label.clone(),
        kind: question.kind.clone(),
        answered_count: answered_count as u64,
        missing_count: missing_count as u64,
        suppressed_value_count,
        numeric,
        distribution,
        note,
    }
}

pub fn analyze_responses(
    schemas: Vec<ResponseSchema>,
    responses: Vec<Response>,
    minimum_group_size: u16,
    generated_at: DateTime<Utc>,
) -> ResponseAnalysis {
    let response_count = responses.len() as u64;
    let mut collections = Vec::new();
    let mut findings = Vec::new();
    let mut visualizations = Vec::new();
    for schema in schemas {
        let collection_responses = responses
            .iter()
            .filter(|response| response.receipt.collection_id == schema.collection_id)
            .collect::<Vec<_>>();
        let suppressed = collection_responses.len() < minimum_group_size as usize;
        let questions = if suppressed {
            Vec::new()
        } else {
            let answer_maps = collection_responses
                .iter()
                .map(|response| &response.answers)
                .collect::<Vec<_>>();
            schema
                .questions
                .iter()
                .map(|question| {
                    analyze_question(question, &answer_maps, minimum_group_size as usize)
                })
                .collect::<Vec<_>>()
        };
        if suppressed && !collection_responses.is_empty() {
            findings.push(Finding {
                kind: "privacy",
                title: format!("{} is waiting for more responses", schema.title),
                detail: format!(
                    "Question-level results appear at {} responses; {} are currently available.",
                    minimum_group_size,
                    collection_responses.len()
                ),
                collection_id: Some(schema.collection_id.clone()),
                question_id: None,
            });
        }
        for question in &questions {
            if let Some(numeric) = &question.numeric {
                findings.push(Finding {
                    kind: "numeric",
                    title: question.label.clone(),
                    detail: format!(
                        "Mean {} and median {} across {} answered responses.",
                        numeric.mean, numeric.median, question.answered_count
                    ),
                    collection_id: Some(schema.collection_id.clone()),
                    question_id: Some(question.question_id.clone()),
                });
            } else if let Some(top) = question.distribution.first() {
                findings.push(Finding {
                    kind: "categorical",
                    title: question.label.clone(),
                    detail: format!(
                        "{} is the most common visible answer ({} of {}, {}%).",
                        top.label, top.count, question.answered_count, top.percentage
                    ),
                    collection_id: Some(schema.collection_id.clone()),
                    question_id: Some(question.question_id.clone()),
                });
            }
            if !question.distribution.is_empty() {
                visualizations.push(Visualization {
                    id: format!("{}:{}", schema.collection_id, question.question_id),
                    collection_id: schema.collection_id.clone(),
                    question_id: question.question_id.clone(),
                    title: question.label.clone(),
                    kind: "bar",
                    x_field: "label",
                    y_field: "count",
                    data: question.distribution.clone(),
                });
            }
        }
        collections.push(CollectionAnalysis {
            collection_id: schema.collection_id,
            survey_id: schema.survey_id,
            version: schema.version,
            title: schema.title,
            response_count: collection_responses.len() as u64,
            suppressed,
            questions,
        });
    }
    collections.sort_by(|a, b| {
        b.response_count
            .cmp(&a.response_count)
            .then_with(|| a.title.cmp(&b.title))
    });
    if response_count == 0 {
        findings.push(Finding {
            kind: "empty",
            title: "No responses yet".into(),
            detail: "Publish and distribute a collection, then refresh the results.".into(),
            collection_id: None,
            question_id: None,
        });
    }
    ResponseAnalysis {
        generated_at,
        response_count,
        collection_count: collections.len() as u64,
        privacy: PrivacySummary {
            minimum_group_size,
            small_cells_suppressed: true,
            text_answers_included: false,
            respondent_metadata_included: false,
            note: "Question results are withheld for small collections, small distribution cells are omitted, and free text plus respondent metadata never appear in this payload.",
        },
        collections,
        findings,
        visualizations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Receipt;
    use serde_json::json;

    fn response(collection_id: &str, answers: Value) -> Response {
        Response {
            receipt: Receipt {
                response_id: uuid::Uuid::new_v4().to_string(),
                collection_id: collection_id.into(),
                accepted: true,
            },
            answers: answers.as_object().unwrap().clone(),
            metadata: Map::from_iter([("email".into(), json!("private@example.com"))]),
            accepted_at: Utc::now(),
            retrieval_sequence: 1,
        }
    }

    fn schema() -> ResponseSchema {
        let question = |id: &str, label: &str, kind: &str| Question {
            id: id.into(),
            label: label.into(),
            kind: kind.into(),
            required: false,
            options: None,
            min: None,
            max: None,
            max_length: None,
            preset: None,
            labels: None,
            min_selections: None,
            max_selections: None,
            presentation: None,
            visible_when: None,
            rows: None,
            columns: None,
            matrix_mode: None,
            items: None,
            total: None,
        };
        let mut score = question("score", "Score", "scale");
        score.required = true;
        score.min = Some(1.0);
        score.max = Some(5.0);
        let mut comment = question("comment", "Comment", "text");
        comment.max_length = Some(200);
        ResponseSchema {
            collection_id: "collection-1".into(),
            survey_id: "survey-1".into(),
            version: 1,
            title: "Product pulse".into(),
            questions: vec![
                score,
                comment,
                question("visit", "Visit date", "date"),
                question("priorities", "Priorities", "ranking"),
            ],
        }
    }

    #[test]
    fn excludes_text_and_metadata_and_suppresses_small_cells() {
        let result = analyze_responses(
            vec![schema()],
            vec![
                response(
                    "collection-1",
                    json!({"score":5,"comment":"secret","visit":"2026-09-01","priorities":["speed","quality"]}),
                ),
                response(
                    "collection-1",
                    json!({"score":5,"comment":"private","visit":"2026-09-02","priorities":["quality","speed"]}),
                ),
                response(
                    "collection-1",
                    json!({"score":1,"comment":"hidden","visit":"2026-09-03","priorities":["speed","quality"]}),
                ),
            ],
            3,
            Utc::now(),
        );
        let encoded = serde_json::to_string(&result).unwrap();
        assert!(!encoded.contains("secret"));
        assert!(!encoded.contains("private@example.com"));
        assert!(!encoded.contains("2026-09-01"));
        assert!(!encoded.contains("speed"));
        assert_eq!(
            result.collections[0].questions[0]
                .numeric
                .as_ref()
                .unwrap()
                .mean,
            3.67
        );
        assert!(result.collections[0].questions[0].distribution.is_empty());
        assert_eq!(result.collections[0].questions[0].suppressed_value_count, 3);
        assert!(result.collections[0].questions[1].distribution.is_empty());
    }

    #[test]
    fn hides_question_results_below_the_collection_threshold() {
        let result = analyze_responses(
            vec![schema()],
            vec![response("collection-1", json!({"score":5}))],
            3,
            Utc::now(),
        );
        assert!(result.collections[0].suppressed);
        assert!(result.collections[0].questions.is_empty());
        assert!(result
            .findings
            .iter()
            .any(|finding| finding.kind == "privacy"));
    }
}
