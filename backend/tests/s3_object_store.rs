use aws_config::BehaviorVersion;
use likerts_server::{
    exports::{ObjectStore, S3ObjectStore},
    Error,
};

#[tokio::test]
#[ignore = "requires the isolated MinIO gate or an explicit S3 test bucket"]
async fn private_s3_store_roundtrips_and_deletes() {
    let bucket = std::env::var("LIKERTS_TEST_S3_BUCKET").expect("test bucket");
    let endpoint = std::env::var("LIKERTS_S3_ENDPOINT").expect("test endpoint");
    let shared = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let client = aws_sdk_s3::Client::from_conf(
        aws_sdk_s3::config::Builder::from(&shared)
            .endpoint_url(endpoint)
            .force_path_style(true)
            .build(),
    );
    let _ = client.create_bucket().bucket(&bucket).send().await;

    let store = S3ObjectStore::from_environment(bucket.clone(), "isolated-test".into())
        .await
        .unwrap();
    let key = format!("{}.json", uuid::Uuid::new_v4());
    store
        .put(&key, b"private export fixture", chrono::Utc::now())
        .await
        .unwrap();
    assert_eq!(store.get(&key).await.unwrap(), b"private export fixture");
    store.delete(&key).await.unwrap();
    assert_eq!(store.get(&key).await, Err(Error::NotFound));

    client.delete_bucket().bucket(bucket).send().await.unwrap();
}
