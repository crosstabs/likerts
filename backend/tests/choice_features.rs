use likerts_server::{schema_version, DraftInput, SdkCapabilities, Store, Submission};
use serde_json::json;

#[test]
fn published_old_choices_remain_immutable_and_v3_requires_capability() {
    let old: DraftInput =
        serde_json::from_str(include_str!("../../contracts/expanded-survey.example.json")).unwrap();
    let enhanced: DraftInput =
        serde_json::from_str(include_str!("../../contracts/choice-survey.example.json")).unwrap();
    let submission: Submission =
        serde_json::from_str(include_str!("../../contracts/choice-response.example.json")).unwrap();
    assert_eq!(schema_version(&old.questions), 2);
    assert_eq!(schema_version(&enhanced.questions), 3);
    let mut store = Store::default();
    let survey = store.create_survey("choices", old.clone()).unwrap();
    store.publish("choices", &survey.id, 1).unwrap();
    let old_collection = store
        .create_collection("choices", &survey.id, 1, "old")
        .unwrap();
    store.update("choices", &survey.id, 1, enhanced).unwrap();
    let old_fleet: SdkCapabilities = serde_json::from_value(
        json!({"installations":[{"target":"web","sdkVersion":"0.0.1","schemaVersions":[1,2]}]}),
    )
    .unwrap();
    assert!(store
        .publish_compatible("choices", &survey.id, 2, old_fleet)
        .is_err());
    store.publish("choices", &survey.id, 2).unwrap();
    let collection = store
        .create_collection("choices", &survey.id, 2, "new")
        .unwrap();
    assert_eq!(
        store
            .schema(&old_collection.id, &old_collection.token)
            .unwrap()
            .questions,
        old.questions
    );
    let mut invalid = submission.clone();
    invalid.answers.insert(
        "reasons".into(),
        json!({"selected":["none","quality"],"otherText":{}}),
    );
    assert!(store
        .submit(&collection.id, &collection.token, invalid)
        .is_err());
    assert_eq!(store.usage("choices"), 0);
    let receipt = store
        .submit(&collection.id, &collection.token, submission.clone())
        .unwrap();
    assert_eq!(
        store
            .submit(&collection.id, &collection.token, submission)
            .unwrap()
            .response_id,
        receipt.response_id
    );
    assert_eq!(store.usage("choices"), 1);
}
