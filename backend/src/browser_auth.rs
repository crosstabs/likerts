use crate::{jwks::JwksCache, Error};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use reqwest::{redirect::Policy, Client, Url};
use serde::Deserialize;
use sha2::Sha256;
use std::collections::HashSet;
use std::{sync::Arc, time::Duration};

#[derive(Clone, Debug, Deserialize)]
pub struct BrowserClaims {
    pub sub: String,
    pub azp: String,
}

#[derive(Clone)]
pub struct BrowserSessionVerifier {
    issuer: String,
    audience: String,
    jwks_url: Url,
    workspace_key: Arc<[u8]>,
    client: Client,
    keys: JwksCache,
}

#[derive(Clone, Default)]
pub struct BrowserOAuthClients(Arc<HashSet<String>>);

impl BrowserOAuthClients {
    pub fn parse(value: Option<&str>) -> Result<Self, Error> {
        let mut clients = HashSet::new();
        for client in value
            .unwrap_or("")
            .split(',')
            .filter(|value| !value.is_empty())
        {
            if client.trim() != client
                || client.len() > 255
                || !client.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':')
                })
                || !clients.insert(client.to_owned())
            {
                return Err(Error::Invalid(
                    "invalid browser OAuth client allowlist".into(),
                ));
            }
        }
        Ok(Self(Arc::new(clients)))
    }

    pub fn allows(&self, client_id: &str) -> bool {
        self.0.contains(client_id)
    }
}

pub fn validate_approved_scopes(scopes: &[String]) -> Result<(), Error> {
    const ALLOWED: &[&str] = &[
        "surveys:read",
        "surveys:write",
        "collections:write",
        "responses:read",
        "responses:write",
        "usage:read",
        "exports:read",
        "exports:write",
        "identity:write",
        "webhooks:read",
        "webhooks:write",
    ];
    if scopes.is_empty() || scopes.len() > 32 {
        return Err(Error::Invalid("invalid OAuth approval scopes".into()));
    }
    let mut unique = HashSet::new();
    if scopes
        .iter()
        .any(|scope| !ALLOWED.contains(&scope.as_str()) || !unique.insert(scope.as_str()))
    {
        return Err(Error::Invalid("invalid OAuth approval scopes".into()));
    }
    Ok(())
}

impl BrowserSessionVerifier {
    pub fn new(
        issuer: &str,
        audience: &str,
        jwks_url: &str,
        workspace_key: &[u8],
    ) -> Result<Self, Error> {
        strict_https_url(issuer, "issuer")?;
        let jwks_url = strict_https_url(jwks_url, "JWKS URL")?;
        if issuer.trim() != issuer
            || audience.trim().is_empty()
            || audience.trim() != audience
            || audience.chars().count() > 500
            || workspace_key.len() != 32
        {
            return Err(Error::Invalid(
                "invalid browser session configuration".into(),
            ));
        }
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| Error::Internal)?;
        Ok(Self {
            issuer: issuer.into(),
            audience: audience.into(),
            jwks_url,
            workspace_key: workspace_key.into(),
            client,
            keys: JwksCache::default(),
        })
    }

    pub async fn verify(&self, token: &str, request_origin: &str) -> Result<BrowserClaims, Error> {
        let header = decode_header(token).map_err(|_| Error::Unauthorized)?;
        if header.alg != Algorithm::RS256 {
            return Err(Error::Unauthorized);
        }
        let kid = header.kid.ok_or(Error::Unauthorized)?;
        let keys = self
            .keys
            .keys_for(&self.client, &self.jwks_url, &kid)
            .await?;
        self.verify_with_keys(token, &kid, &keys, request_origin)
    }

    fn verify_with_keys(
        &self,
        token: &str,
        kid: &str,
        keys: &JwkSet,
        request_origin: &str,
    ) -> Result<BrowserClaims, Error> {
        let key = DecodingKey::from_jwk(keys.find(kid).ok_or(Error::Unauthorized)?)
            .map_err(|_| Error::Unauthorized)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.leeway = 60;
        validation.set_audience(&[&self.audience]);
        validation.set_issuer(&[&self.issuer]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<BrowserClaims>(token, &key, &validation)
            .map_err(|_| Error::Unauthorized)?
            .claims;
        if claims.sub.trim().is_empty()
            || claims.sub.chars().count() > 255
            || claims.azp != request_origin
            || !strict_origin(&claims.azp)
        {
            return Err(Error::Unauthorized);
        }
        Ok(claims)
    }

    pub fn workspace_id(&self, subject: &str) -> Result<String, Error> {
        if subject.trim().is_empty() || subject.chars().count() > 255 {
            return Err(Error::Unauthorized);
        }
        let mut mac =
            Hmac::<Sha256>::new_from_slice(&self.workspace_key).map_err(|_| Error::Internal)?;
        mac.update(self.issuer.as_bytes());
        mac.update(&[0]);
        mac.update(subject.as_bytes());
        let digest = mac.finalize().into_bytes();
        Ok(format!("ws_{}", URL_SAFE_NO_PAD.encode(&digest[..18])))
    }
}

fn strict_https_url(value: &str, field: &str) -> Result<Url, Error> {
    let url = Url::parse(value)
        .map_err(|_| Error::Invalid(format!("invalid browser session {field}")))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Invalid(format!("invalid browser session {field}")));
    }
    Ok(url)
}

fn strict_origin(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;

    fn verifier() -> BrowserSessionVerifier {
        BrowserSessionVerifier::new(
            "https://clerk.example",
            "https://api.likerts.test",
            "https://clerk.example/jwks",
            &[7; 32],
        )
        .unwrap()
    }

    fn signed(origin: &str, audience: &str, expires: i64) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("local-test-key".into());
        encode(&header, &json!({"iss":"https://clerk.example","aud":audience,"sub":"user_123","azp":origin,"exp":expires}), &EncodingKey::from_rsa_pem(include_bytes!("../tests/fixtures/oidc_test_private.pem")).unwrap()).unwrap()
    }

    fn keys() -> JwkSet {
        serde_json::from_str(r#"{"keys":[{"kty":"RSA","n":"3gSTfWyHyhpOnM0wKcfcdAs5gy7U4m-_IAEA6kmC20_wNQI3MbJ2V8CG8JKuq6yNqa2PWUx9lH5EFJv2R80pd2dXWybN-EBs6ToV9ooHfHApP2o6mmT2t4WdQERKfoTJ_vSjZVsVXMVbArvtmPctY4_XHSKDaWAXnDZREP4666laW1uMlyBPHPgaCnCA1RB7DFEgtXXF-RuUJKVvp4NXMIgwmzGfGkFQTY4tWumxzrrqwGCiYC5e5iplz6OSMLnNlUex7biuTMJ3h7g8JDroW3rnPLq9_uNoZMylimliBhDTH8_aeZh8ztZLea8VgcuR05bWxUugUO0CfqwDyLxZMQ","e":"AQAB","kid":"local-test-key","use":"sig","alg":"RS256"}]}"#).unwrap()
    }

    #[test]
    fn session_requires_exact_audience_expiry_and_authorized_party() {
        let verifier = verifier();
        let now = Utc::now().timestamp();
        assert!(verifier
            .verify_with_keys(
                &signed(
                    "https://console.likerts.app",
                    "https://api.likerts.test",
                    now + 300
                ),
                "local-test-key",
                &keys(),
                "https://console.likerts.app"
            )
            .is_ok());
        assert!(verifier
            .verify_with_keys(
                &signed(
                    "https://evil.example",
                    "https://api.likerts.test",
                    now + 300
                ),
                "local-test-key",
                &keys(),
                "https://console.likerts.app"
            )
            .is_err());
        assert!(verifier
            .verify_with_keys(
                &signed("https://console.likerts.app", "wrong", now + 300),
                "local-test-key",
                &keys(),
                "https://console.likerts.app"
            )
            .is_err());
        assert!(verifier
            .verify_with_keys(
                &signed(
                    "https://console.likerts.app",
                    "https://api.likerts.test",
                    now - 300
                ),
                "local-test-key",
                &keys(),
                "https://console.likerts.app"
            )
            .is_err());
    }

    #[test]
    fn workspace_id_is_stable_keyed_and_subject_specific() {
        let verifier = verifier();
        assert_eq!(
            verifier.workspace_id("user_123").unwrap(),
            verifier.workspace_id("user_123").unwrap()
        );
        assert_ne!(
            verifier.workspace_id("user_123").unwrap(),
            verifier.workspace_id("user_456").unwrap()
        );
        assert_ne!(
            verifier.workspace_id("user_123").unwrap(),
            BrowserSessionVerifier::new(
                "https://clerk.example",
                "https://api.likerts.test",
                "https://clerk.example/jwks",
                &[8; 32]
            )
            .unwrap()
            .workspace_id("user_123")
            .unwrap()
        );
    }

    #[test]
    fn oauth_approval_inputs_are_explicit_and_bounded() {
        let clients = BrowserOAuthClients::parse(Some("codex-prod,claude-prod")).unwrap();
        assert!(clients.allows("codex-prod"));
        assert!(!clients.allows("unknown"));
        assert!(BrowserOAuthClients::parse(Some("*,client")).is_err());
        assert!(validate_approved_scopes(&["usage:read".into(), "surveys:read".into()]).is_ok());
        assert!(validate_approved_scopes(&["usage:read".into(), "usage:read".into()]).is_err());
        assert!(validate_approved_scopes(&["admin:*".into()]).is_err());
    }
}
