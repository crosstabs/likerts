// Isolated staging harness: wire into the service only after shared integration is released.
use likerts_server::Error;
#[allow(dead_code)]
#[path = "../src/callback_liveness.rs"]
mod callback_liveness;
#[allow(dead_code)]
#[path = "../src/webhook_store.rs"]
mod webhook_store;
#[allow(dead_code)]
#[path = "../src/webhooks.rs"]
mod webhooks;
