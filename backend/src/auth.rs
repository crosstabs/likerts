use crate::{jwks::JwksCache, Error};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use reqwest::{redirect::Policy, Client, Url};
use serde::Deserialize;
use std::{collections::HashSet, time::Duration};

#[derive(Clone, Debug, Deserialize)]
pub struct OidcClaims {
    pub sub: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub azp: Option<String>,
    #[serde(default, rename = "https://likerts.app/grant_id")]
    pub grant_id: Option<String>,
}

impl OidcClaims {
    pub fn scopes(&self) -> HashSet<&str> {
        self.scope.split_ascii_whitespace().collect()
    }

    pub fn oauth_client_id(&self) -> Result<&str, Error> {
        // OAuth access tokens carry a client identifier. `azp` also appears on
        // browser session/ID tokens, so accepting it as a substitute creates a
        // token-type confusion path at the API boundary.
        self.client_id
            .as_deref()
            .filter(|client_id| {
                !client_id.trim().is_empty()
                    && client_id.trim() == *client_id
                    && client_id.chars().count() <= 256
            })
            .ok_or(Error::Unauthorized)
    }
}

#[derive(Clone)]
pub struct OidcVerifier {
    issuer: String,
    audience: String,
    jwks_url: Url,
    client: Client,
    keys: JwksCache,
}

impl OidcVerifier {
    pub fn new(issuer: &str, audience: &str, jwks_url: &str) -> Result<Self, Error> {
        if issuer.trim() != issuer || audience.trim() != audience || jwks_url.trim() != jwks_url {
            return Err(Error::Invalid("invalid OIDC configuration".into()));
        }
        let issuer_url =
            Url::parse(issuer).map_err(|_| Error::Invalid("invalid OIDC issuer".into()))?;
        let jwks_url =
            Url::parse(jwks_url).map_err(|_| Error::Invalid("invalid OIDC JWKS URL".into()))?;
        if issuer_url.scheme() != "https"
            || issuer_url.username() != ""
            || issuer_url.password().is_some()
            || issuer_url.query().is_some()
            || issuer_url.fragment().is_some()
            || audience.trim().is_empty()
            || audience.chars().count() > 500
            || jwks_url.scheme() != "https"
            || jwks_url.username() != ""
            || jwks_url.password().is_some()
            || jwks_url.query().is_some()
            || jwks_url.fragment().is_some()
        {
            return Err(Error::Invalid("invalid OIDC configuration".into()));
        }
        let audience_url = Url::parse(audience)
            .map_err(|_| Error::Invalid("OIDC audience must be an HTTPS resource origin".into()))?;
        if audience_url.scheme() != "https"
            || audience_url.username() != ""
            || audience_url.password().is_some()
            || audience_url.path() != "/"
            || audience_url.query().is_some()
            || audience_url.fragment().is_some()
        {
            return Err(Error::Invalid(
                "OIDC audience must be an HTTPS resource origin".into(),
            ));
        }
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| Error::Internal)?;
        Ok(Self {
            // JWT `iss` is an exact identifier. Preserve the configured form instead of
            // normalizing a host-only issuer to a trailing slash.
            issuer: issuer.into(),
            audience: audience.into(),
            jwks_url,
            client,
            keys: JwksCache::default(),
        })
    }

    pub async fn verify(&self, token: &str) -> Result<OidcClaims, Error> {
        let header = decode_header(token).map_err(|_| Error::Unauthorized)?;
        if header.alg != Algorithm::RS256 {
            return Err(Error::Unauthorized);
        }
        let kid = header.kid.ok_or(Error::Unauthorized)?;
        let keys = self
            .keys
            .keys_for(&self.client, &self.jwks_url, &kid)
            .await?;
        self.verify_with_keys(token, &kid, &keys)
    }

    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    pub fn audience(&self) -> &str {
        &self.audience
    }

    pub fn protected_resource_metadata_url(&self) -> String {
        format!(
            "{}/.well-known/oauth-protected-resource",
            self.audience.trim_end_matches('/')
        )
    }

    pub fn jwks_url(&self) -> &Url {
        &self.jwks_url
    }

    fn verify_with_keys(&self, token: &str, kid: &str, keys: &JwkSet) -> Result<OidcClaims, Error> {
        let jwk = keys.find(kid).ok_or(Error::Unauthorized)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| Error::Unauthorized)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.leeway = 60;
        validation.set_audience(&[&self.audience]);
        validation.set_issuer(&[&self.issuer]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        let claims = decode::<OidcClaims>(token, &key, &validation)
            .map_err(|_| Error::Unauthorized)?
            .claims;
        if claims.sub.trim().is_empty()
            || claims.sub.trim() != claims.sub
            || claims.sub.chars().count() > 255
            || claims.scope.chars().count() > 4096
            || claims.oauth_client_id().is_err()
            || claims
                .grant_id
                .as_deref()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
        {
            return Err(Error::Unauthorized);
        }
        Ok(claims)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};

    #[test]
    fn configuration_and_scope_parsing_are_strict() {
        assert!(OidcVerifier::new(
            "http://tenant.example",
            "api",
            "https://tenant.example/.well-known/jwks.json"
        )
        .is_err());
        assert!(OidcVerifier::new(
            "https://user@tenant.example",
            "api",
            "https://tenant.example/.well-known/jwks.json"
        )
        .is_err());
        assert!(OidcVerifier::new(
            "https://tenant.example",
            " ",
            "https://tenant.example/.well-known/jwks.json"
        )
        .is_err());
        assert!(OidcVerifier::new(
            "https://tenant.example",
            "api-client-id",
            "https://tenant.example/.well-known/jwks.json"
        )
        .is_err());
        assert!(OidcVerifier::new(
            "https://tenant.example",
            "api",
            "http://tenant.example/.well-known/jwks.json"
        )
        .is_err());
        let verifier = OidcVerifier::new(
            "https://well-hagfish-71.clerk.accounts.dev",
            "https://api.likerts.test",
            "https://well-hagfish-71.clerk.accounts.dev/.well-known/jwks.json",
        )
        .unwrap();
        assert_eq!(
            verifier.issuer(),
            "https://well-hagfish-71.clerk.accounts.dev"
        );
        assert_eq!(
            verifier.jwks_url().as_str(),
            "https://well-hagfish-71.clerk.accounts.dev/.well-known/jwks.json"
        );
        let claims = OidcClaims {
            sub: "user_2abc".into(),
            scope: "surveys:read responses:read surveys:read".into(),
            client_id: Some("oauth_app_2abc".into()),
            azp: None,
            grant_id: Some(uuid::Uuid::new_v4().to_string()),
        };
        assert_eq!(
            claims.scopes(),
            HashSet::from(["surveys:read", "responses:read"])
        );
    }

    #[test]
    fn verifies_rs256_signature_issuer_and_audience() {
        let token = signed_token(
            "https://well-hagfish-71.clerk.accounts.dev",
            "https://api.likerts.test",
            chrono::Utc::now().timestamp() + 300,
        );
        let verifier = OidcVerifier::new(
            "https://well-hagfish-71.clerk.accounts.dev",
            "https://api.likerts.test",
            "https://well-hagfish-71.clerk.accounts.dev/.well-known/jwks.json",
        )
        .unwrap();
        let claims = verifier
            .verify_with_keys(&token, "local-test-key", &local_keys())
            .unwrap();
        assert_eq!(claims.sub, "user_2local");
        assert_eq!(claims.oauth_client_id().unwrap(), "oauth_app_2local");
        assert!(claims.scopes().contains("responses:read"));
        let wrong_audience = OidcVerifier::new(
            "https://well-hagfish-71.clerk.accounts.dev",
            "https://wrong",
            "https://well-hagfish-71.clerk.accounts.dev/.well-known/jwks.json",
        )
        .unwrap();
        assert!(matches!(
            wrong_audience.verify_with_keys(&token, "local-test-key", &local_keys()),
            Err(Error::Unauthorized)
        ));
        assert!(matches!(
            verifier.verify_with_keys(&format!("{token}x"), "local-test-key", &local_keys()),
            Err(Error::Unauthorized)
        ));
        let session_or_id_token_shape = OidcClaims {
            sub: "provider-subject".into(),
            scope: String::new(),
            client_id: None,
            azp: Some("oauth-client".into()),
            grant_id: None,
        };
        assert!(matches!(
            session_or_id_token_shape.oauth_client_id(),
            Err(Error::Unauthorized)
        ));
        let oauth_access_token_shape = OidcClaims {
            client_id: Some("client-one".into()),
            azp: Some("client-two".into()),
            ..session_or_id_token_shape
        };
        assert_eq!(
            oauth_access_token_shape.oauth_client_id().unwrap(),
            "client-one"
        );
        assert_eq!(
            verifier.protected_resource_metadata_url(),
            "https://api.likerts.test/.well-known/oauth-protected-resource"
        );
    }

    fn local_keys() -> JwkSet {
        serde_json::from_str(r#"{"keys":[{"kty":"RSA","n":"3gSTfWyHyhpOnM0wKcfcdAs5gy7U4m-_IAEA6kmC20_wNQI3MbJ2V8CG8JKuq6yNqa2PWUx9lH5EFJv2R80pd2dXWybN-EBs6ToV9ooHfHApP2o6mmT2t4WdQERKfoTJ_vSjZVsVXMVbArvtmPctY4_XHSKDaWAXnDZREP4666laW1uMlyBPHPgaCnCA1RB7DFEgtXXF-RuUJKVvp4NXMIgwmzGfGkFQTY4tWumxzrrqwGCiYC5e5iplz6OSMLnNlUex7biuTMJ3h7g8JDroW3rnPLq9_uNoZMylimliBhDTH8_aeZh8ztZLea8VgcuR05bWxUugUO0CfqwDyLxZMQ","e":"AQAB","kid":"local-test-key","use":"sig","alg":"RS256"}]}"#).unwrap()
    }

    fn signed_token(issuer: &str, audience: &str, expires_at: i64) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("local-test-key".into());
        encode(
            &header,
            &serde_json::json!({
                "iss": issuer,
                "aud": audience,
                "sub": "user_2local",
                "client_id": "oauth_app_2local",
                "scope": "surveys:read responses:read",
                "exp": expires_at,
                "https://likerts.app/grant_id": "11111111-1111-4111-8111-111111111111"
            }),
            &EncodingKey::from_rsa_pem(include_bytes!("../tests/fixtures/oidc_test_private.pem"))
                .unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn rejects_expired_wrong_issuer_and_wrong_audience_tokens() {
        let keys = local_keys();
        let verifier = OidcVerifier::new(
            "https://tenant.example",
            "https://api.likerts.test",
            "https://tenant.example/.well-known/jwks.json",
        )
        .unwrap();
        let now = chrono::Utc::now().timestamp();
        let valid = signed_token(
            "https://tenant.example",
            "https://api.likerts.test",
            now + 300,
        );
        assert_eq!(
            verifier
                .verify_with_keys(&valid, "local-test-key", &keys)
                .unwrap()
                .sub,
            "user_2local"
        );
        let expired = signed_token(
            "https://tenant.example",
            "https://api.likerts.test",
            now - 120,
        );
        assert!(matches!(
            verifier.verify_with_keys(&expired, "local-test-key", &keys),
            Err(Error::Unauthorized)
        ));
        let wrong_issuer = signed_token(
            "https://attacker.example/",
            "https://api.likerts.test",
            now + 300,
        );
        assert!(matches!(
            verifier.verify_with_keys(&wrong_issuer, "local-test-key", &keys),
            Err(Error::Unauthorized)
        ));
        let wrong_audience = signed_token(
            "https://tenant.example",
            "https://other-api.example",
            now + 300,
        );
        assert!(matches!(
            verifier.verify_with_keys(&wrong_audience, "local-test-key", &keys),
            Err(Error::Unauthorized)
        ));
    }
}
