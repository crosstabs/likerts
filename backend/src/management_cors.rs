use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use reqwest::Url;
use std::{collections::HashSet, sync::Arc};

#[derive(Clone, Default)]
pub struct ManagementCors(Arc<HashSet<String>>);

impl ManagementCors {
    pub fn parse(value: Option<&str>) -> Result<Self, &'static str> {
        let mut origins = HashSet::new();
        let Some(value) = value else {
            return Ok(Self::default());
        };
        if value.is_empty() {
            return Err("LIKERTS_MANAGEMENT_ORIGINS cannot be empty when configured");
        }
        for raw in value.split(',') {
            let origin = raw.trim();
            if origin.is_empty()
                || origin != raw
                || !valid_origin(origin)
                || !origins.insert(origin.to_owned())
            {
                return Err("LIKERTS_MANAGEMENT_ORIGINS must contain unique exact HTTPS or loopback HTTP origins");
            }
        }
        Ok(Self(Arc::new(origins)))
    }

    pub fn allows(&self, origin: &str) -> bool {
        self.0.contains(origin)
    }
}

fn valid_origin(origin: &str) -> bool {
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    let loopback = url.scheme() == "http"
        && url
            .host_str()
            .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"));
    (url.scheme() == "https" || loopback)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn public_collection_request(method: &Method, path: &str) -> bool {
    let parts = path.trim_matches('/').split('/').collect::<Vec<_>>();
    (parts.len() == 3
        && parts[..2] == ["v1", "collections"]
        && matches!(*method, Method::GET | Method::OPTIONS))
        || (parts.len() == 4
            && parts[..2] == ["v1", "collections"]
            && parts[3] == "responses"
            && matches!(*method, Method::POST | Method::OPTIONS))
}

fn add_headers(headers: &mut HeaderMap, origin: &str, preflight: bool) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_str(origin).expect("validated origin"),
    );
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    if preflight {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Authorization, Content-Type, X-Likerts-Workspace"),
        );
        headers.insert(
            header::ACCESS_CONTROL_MAX_AGE,
            HeaderValue::from_static("600"),
        );
    }
}

pub async fn enforce(
    State(policy): State<ManagementCors>,
    request: Request,
    next: Next,
) -> Response {
    if !request.uri().path().starts_with("/v1/")
        || public_collection_request(request.method(), request.uri().path())
    {
        return next.run(request).await;
    }
    let Some(origin) = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
    else {
        return next.run(request).await;
    };
    if !policy.allows(&origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request.method() == Method::OPTIONS {
        let method_ok = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_METHOD)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| matches!(value, "GET" | "POST" | "PUT" | "PATCH" | "DELETE"));
        let headers_ok = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
            .and_then(|value| value.to_str().ok())
            .map(|value| {
                value.split(',').all(|name| {
                    matches!(
                        name.trim().to_ascii_lowercase().as_str(),
                        "authorization" | "content-type" | "x-likerts-workspace"
                    )
                })
            })
            .unwrap_or(true);
        if !method_ok || !headers_ok {
            return StatusCode::FORBIDDEN.into_response();
        }
        let mut response = StatusCode::NO_CONTENT.into_response();
        add_headers(response.headers_mut(), &origin, true);
        return response;
    }
    let mut response = next.run(request).await;
    add_headers(response.headers_mut(), &origin, false);
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, middleware, routing::get, Router};
    use tower::ServiceExt;

    #[test]
    fn allowlist_is_exact_and_has_no_wildcards_or_paths() {
        let policy =
            ManagementCors::parse(Some("https://console.likerts.app,http://localhost:3000"))
                .unwrap();
        assert!(policy.allows("https://console.likerts.app"));
        assert!(!policy.allows("https://evil.console.likerts.app"));
        for invalid in [
            "",
            ",",
            "https://console.likerts.app,",
            "*",
            "http://console.likerts.app",
            "https://console.likerts.app/path",
            "https://user@console.likerts.app",
            "https://console.likerts.app, https://other.example",
        ] {
            assert!(ManagementCors::parse(Some(invalid)).is_err());
        }
    }

    #[tokio::test]
    async fn preflight_allows_only_declared_origin_method_and_headers_without_credentials() {
        let policy = ManagementCors::parse(Some("https://console.likerts.app")).unwrap();
        let app = Router::new()
            .route("/v1/usage", get(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(policy, enforce));
        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("/v1/usage")
            .header("origin", "https://console.likerts.app")
            .header("access-control-request-method", "GET")
            .header(
                "access-control-request-headers",
                "authorization,x-likerts-workspace",
            )
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "https://console.likerts.app"
        );
        assert!(!response
            .headers()
            .contains_key(header::ACCESS_CONTROL_ALLOW_CREDENTIALS));

        let denied = Request::builder()
            .method(Method::OPTIONS)
            .uri("/v1/usage")
            .header("origin", "https://evil.example")
            .header("access-control-request-method", "GET")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.oneshot(denied).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
}
