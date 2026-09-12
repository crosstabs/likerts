#[allow(dead_code)]
#[path = "../src/metrics.rs"]
mod metrics;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    middleware,
    routing::get,
    Router,
};
use metrics::Metrics;
use tower::ServiceExt;
const TOKEN: &str = "synthetic-monitor-token-not-production-123";

fn router(metrics: Metrics) -> Router {
    Router::new()
        .route("/v1/surveys/{id}", get(|| async { StatusCode::OK }))
        .route("/health", get(|| async { StatusCode::OK }))
        .route(
            "/internal/metrics",
            get(metrics::scrape).with_state(metrics.clone()),
        )
        .layer(middleware::from_fn_with_state(metrics, metrics::observe))
}

#[tokio::test]
async fn scrape_requires_separate_secret_and_never_labels_ids_or_queries() {
    assert!(Metrics::new(Some("short".into())).is_err());
    let app = router(Metrics::new(Some(TOKEN.into())).unwrap());
    for id in ["private-client-a", "private-client-b"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/surveys/{id}?token=secret-value"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/unregistered-secret-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    for token in [None, Some("wrong-monitor-token-with-sufficient-length")] {
        let mut request = Request::builder().uri("/internal/metrics");
        if let Some(token) = token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        assert_eq!(
            app.clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    let response = app
        .oneshot(
            Request::builder()
                .uri("/internal/metrics")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = String::from_utf8(
        to_bytes(response.into_body(), 100000)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("likerts_http_requests_total{route=\"/v1/surveys/{id}\",method=\"GET\",status_class=\"2xx\"} 2"));
    assert!(body.contains("route=\"unmatched\""));
    assert!(body.contains("likerts_http_in_flight 0"));
    for forbidden in [
        "private-client",
        "secret-value",
        "unregistered-secret-id",
        TOKEN,
        "/health",
        "/internal/metrics",
    ] {
        assert!(!body.contains(forbidden));
    }
}

#[tokio::test]
async fn monitoring_is_disabled_without_a_configured_token() {
    let response = router(Metrics::new(None).unwrap())
        .oneshot(
            Request::builder()
                .uri("/internal/metrics")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cancelled_handlers_release_in_flight_and_increment_cancellation_counter() {
    let metrics = Metrics::new(Some(TOKEN.into())).unwrap();
    let entered = std::sync::Arc::new(tokio::sync::Notify::new());
    let notify = entered.clone();
    let app = router(metrics.clone()).merge(
        Router::new()
            .route(
                "/slow",
                get(move || {
                    let notify = notify.clone();
                    async move {
                        notify.notify_one();
                        std::future::pending::<StatusCode>().await
                    }
                }),
            )
            .layer(middleware::from_fn_with_state(metrics, metrics::observe)),
    );
    let active = app.clone();
    let task = tokio::spawn(async move {
        active
            .oneshot(Request::builder().uri("/slow").body(Body::empty()).unwrap())
            .await
    });
    entered.notified().await;
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/internal/metrics")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = String::from_utf8(
        to_bytes(response.into_body(), 100000)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(body.contains("likerts_http_in_flight 0"));
    assert!(body.contains("likerts_http_cancelled_total 1"));
}
