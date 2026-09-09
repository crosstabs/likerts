//! Internal, bounded Prometheus metrics. Never label by tenant, ID, token or URI.
use axum::{
    extract::{MatchedPath, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::{
    collections::BTreeMap,
    fmt::Write,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

const BOUNDS: [f64; 12] = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
];
const TOKEN_CONTEXT: &[u8] = b"likerts-internal-monitor-v1";

#[derive(Clone)]
pub struct Metrics(Arc<Inner>);
struct Inner {
    token_tag: Option<Vec<u8>>,
    started: Instant,
    in_flight: AtomicU64,
    cancelled: AtomicU64,
    cells: Mutex<BTreeMap<(String, &'static str, u16), Cell>>,
}
#[derive(Default)]
struct Cell {
    count: u64,
    seconds: f64,
    buckets: [u64; 12],
}

impl Metrics {
    pub fn new(token: Option<String>) -> Result<Self, &'static str> {
        let token_tag = token
            .map(|token| {
                if !(32..=512).contains(&token.len())
                    || !token.bytes().all(|b| b.is_ascii_graphic())
                {
                    return Err("monitor token must contain 32 to 512 visible ASCII characters");
                }
                let mut mac = Hmac::<Sha256>::new_from_slice(token.as_bytes())
                    .expect("HMAC accepts every key length");
                mac.update(TOKEN_CONTEXT);
                Ok(mac.finalize().into_bytes().to_vec())
            })
            .transpose()?;
        Ok(Self(Arc::new(Inner {
            token_tag,
            started: Instant::now(),
            in_flight: AtomicU64::new(0),
            cancelled: AtomicU64::new(0),
            cells: Mutex::new(BTreeMap::new()),
        })))
    }

    pub fn from_env() -> Result<Self, &'static str> {
        match std::env::var("LIKERTS_MONITOR_TOKEN") {
            Ok(token) => Self::new(Some(token)),
            Err(std::env::VarError::NotPresent) => Self::new(None),
            Err(_) => Err("invalid LIKERTS_MONITOR_TOKEN encoding"),
        }
    }

    fn authorized(&self, headers: &HeaderMap) -> bool {
        let Some(expected_tag) = &self.0.token_tag else {
            return false;
        };
        let Some(candidate) = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|v| (32..=512).contains(&v.len()))
        else {
            return false;
        };
        let mut mac = Hmac::<Sha256>::new_from_slice(candidate.as_bytes())
            .expect("HMAC accepts every key length");
        mac.update(TOKEN_CONTEXT);
        mac.verify_slice(expected_tag).is_ok()
    }

    fn record(&self, route: String, method: &'static str, status: u16, seconds: f64) {
        let mut cells = self.0.cells.lock().unwrap_or_else(|e| e.into_inner());
        let cell = cells.entry((route, method, status / 100)).or_default();
        cell.count += 1;
        cell.seconds += seconds;
        for (bucket, bound) in cell.buckets.iter_mut().zip(BOUNDS) {
            if seconds <= bound {
                *bucket += 1;
            }
        }
    }

    fn render(&self) -> String {
        let mut output = String::from(
            "# HELP likerts_http_requests_total Completed HTTP handler responses.\n# TYPE likerts_http_requests_total counter\n\
             # HELP likerts_http_handler_duration_seconds HTTP handler latency, excluding response-body transmission.\n# TYPE likerts_http_handler_duration_seconds histogram\n",
        );
        let cells = self.0.cells.lock().unwrap_or_else(|e| e.into_inner());
        for ((route, method, status_class), cell) in cells.iter() {
            let route = route
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n");
            let labels =
                format!("route=\"{route}\",method=\"{method}\",status_class=\"{status_class}xx\"");
            let _ = writeln!(
                output,
                "likerts_http_requests_total{{{labels}}} {}",
                cell.count
            );
            for (bound, count) in BOUNDS.iter().zip(cell.buckets) {
                let _ = writeln!(output, "likerts_http_handler_duration_seconds_bucket{{{labels},le=\"{bound}\"}} {count}");
            }
            let _ = writeln!(
                output,
                "likerts_http_handler_duration_seconds_bucket{{{labels},le=\"+Inf\"}} {}",
                cell.count
            );
            let _ = writeln!(
                output,
                "likerts_http_handler_duration_seconds_count{{{labels}}} {}",
                cell.count
            );
            let _ = writeln!(
                output,
                "likerts_http_handler_duration_seconds_sum{{{labels}}} {}",
                cell.seconds
            );
        }
        let _ = writeln!(
            output,
            "# TYPE likerts_http_in_flight gauge\nlikerts_http_in_flight {}",
            self.0.in_flight.load(Ordering::Relaxed)
        );
        let _ = writeln!(
            output,
            "# TYPE likerts_http_cancelled_total counter\nlikerts_http_cancelled_total {}",
            self.0.cancelled.load(Ordering::Relaxed)
        );
        let _ = writeln!(
            output,
            "# TYPE likerts_process_uptime_seconds gauge\nlikerts_process_uptime_seconds {}",
            self.0.started.elapsed().as_secs_f64()
        );
        output
    }
}

struct InFlight {
    inner: Arc<Inner>,
    completed: bool,
}
impl Drop for InFlight {
    fn drop(&mut self) {
        self.inner.in_flight.fetch_sub(1, Ordering::Relaxed);
        if !self.completed {
            self.inner.cancelled.fetch_add(1, Ordering::Relaxed);
        }
    }
}

pub async fn observe(State(metrics): State<Metrics>, request: Request, next: Next) -> Response {
    if metrics.0.token_tag.is_none()
        || matches!(request.uri().path(), "/health" | "/internal/metrics")
    {
        return next.run(request).await;
    }
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".into());
    let method = match request.method().as_str() {
        "GET" => "GET",
        "POST" => "POST",
        "PUT" => "PUT",
        "PATCH" => "PATCH",
        "DELETE" => "DELETE",
        "OPTIONS" => "OPTIONS",
        "HEAD" => "HEAD",
        _ => "OTHER",
    };
    metrics.0.in_flight.fetch_add(1, Ordering::Relaxed);
    let mut guard = InFlight {
        inner: metrics.0.clone(),
        completed: false,
    };
    let started = Instant::now();
    let response = next.run(request).await;
    metrics.record(
        route,
        method,
        response.status().as_u16(),
        started.elapsed().as_secs_f64(),
    );
    guard.completed = true;
    response
}

pub async fn scrape(State(metrics): State<Metrics>, headers: HeaderMap) -> Response {
    if metrics.0.token_tag.is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !metrics.authorized(&headers) {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, "no-store")],
        )
            .into_response();
    }
    (
        [
            (
                header::CONTENT_TYPE,
                "text/plain; version=0.0.4; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        metrics.render(),
    )
        .into_response()
}
