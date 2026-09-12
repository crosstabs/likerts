# Identity test fixture

`oidc_test_private.pem` is an intentionally public test-only RSA key. `backend/src/auth.rs` uses it inside its `#[cfg(test)]` module to create synthetic JWTs for issuer, audience, expiry and signature checks. It is not a deployment credential; never use it for a trusted issuer or production authentication. The OCI build context excludes this directory.
