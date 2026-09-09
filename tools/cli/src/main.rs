use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    fs::OpenOptions,
    io::{self, Read},
    net::TcpListener,
    path::PathBuf,
    process::Command,
    time::Duration,
};

#[derive(Deserialize)]
struct Capability {
    name: String,
    method: String,
    path: String,
    description: String,
    auth: String,
}
fn registry() -> Vec<Capability> {
    serde_json::from_str(include_str!("../../capabilities.json")).expect("valid bundled registry")
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCredential {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    token_endpoint: String,
    client_id: String,
    expires_at_unix: u64,
    revocation_endpoint: String,
}

fn credential_path() -> Result<PathBuf, String> {
    let base = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or("Cannot locate user configuration directory")?;
    Ok(base.join("likerts").join("credentials.json"))
}

fn save_credential(credential: &StoredCredential) -> Result<(), String> {
    save_credential_at(&credential_path()?, credential)
}

fn save_credential_at(path: &std::path::Path, credential: &StoredCredential) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid credential path")?;
    fs::create_dir_all(parent).map_err(|_| "Cannot create credential directory")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect credential directory")?;
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
    let encoded = serde_json::to_vec(credential).map_err(|_| "Cannot encode credential")?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "Cannot write credential")?;
    use std::io::Write;
    file.write_all(&encoded)
        .map_err(|_| "Cannot write credential")?;
    file.sync_all().map_err(|_| "Cannot write credential")?;
    fs::rename(temporary, path).map_err(|_| "Cannot install credential".into())
}

fn load_credential() -> Result<StoredCredential, String> {
    load_credential_at(&credential_path()?)
}

fn load_credential_at(path: &std::path::Path) -> Result<StoredCredential, String> {
    let bytes = fs::read(path).map_err(|_| "Run `likerts auth login` first")?;
    serde_json::from_slice(&bytes).map_err(|_| "Stored credential is invalid".into())
}

fn remove_credential_at(path: &std::path::Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Cannot remove stored credential".into()),
    }
}

fn revoke_remote_refresh(credential: &StoredCredential) -> Result<(), String> {
    let Some(refresh_token) = credential.refresh_token.as_deref() else {
        return Ok(());
    };
    let endpoint = reqwest::Url::parse(&credential.revocation_endpoint)
        .map_err(|_| "Stored revocation endpoint is invalid")?;
    if endpoint.scheme() != "https" {
        return Err("Stored revocation endpoint must use HTTPS".into());
    }
    reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Cannot initialize HTTP client")?
        .post(endpoint)
        .form(&[
            ("client_id", credential.client_id.as_str()),
            ("token", refresh_token),
        ])
        .send()
        .map_err(|_| "Remote OAuth revocation failed")?
        .error_for_status()
        .map(|_| ())
        .map_err(|_| "Remote OAuth revocation was rejected".into())
}

fn logout_credential_at(path: &std::path::Path) -> Result<(), String> {
    let remote_result = load_credential_at(path)
        .ok()
        .map_or(Ok(()), |credential| revoke_remote_refresh(&credential));
    remove_credential_at(path)?;
    remote_result
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn stored_access_token() -> Result<String, String> {
    let mut credential = load_credential()?;
    if credential.expires_at_unix > unix_now().saturating_add(60) {
        return Ok(credential.access_token);
    }
    let refresh = credential
        .refresh_token
        .as_deref()
        .ok_or("Stored OAuth credential expired; run `likerts auth login`")?;
    let endpoint = reqwest::Url::parse(&credential.token_endpoint)
        .map_err(|_| "Stored token endpoint is invalid")?;
    if endpoint.scheme() != "https" {
        return Err("Stored token endpoint must use HTTPS".into());
    }
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Cannot initialize HTTP client")?;
    let response: Value = client
        .post(endpoint)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", credential.client_id.as_str()),
            ("refresh_token", refresh),
        ])
        .send()
        .map_err(|_| "OAuth refresh failed")?
        .error_for_status()
        .map_err(|_| "OAuth refresh was rejected")?
        .json()
        .map_err(|_| "Invalid OAuth refresh response")?;
    apply_refresh_response(&mut credential, &response, unix_now())?;
    let access_token = credential.access_token.clone();
    save_credential(&credential)?;
    Ok(access_token)
}

fn apply_refresh_response(
    credential: &mut StoredCredential,
    response: &Value,
    now: u64,
) -> Result<(), String> {
    credential.access_token = response
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("Refreshed access token missing")?
        .into();
    if let Some(rotated) = response.get("refresh_token").and_then(Value::as_str) {
        credential.refresh_token = Some(rotated.into());
    }
    credential.expires_at_unix = now.saturating_add(
        response
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(300),
    );
    Ok(())
}

fn pkce_pair() -> (String, String) {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn oauth_callback_code(target: &str, expected_state: &str) -> Result<String, String> {
    let callback_url = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "Invalid OAuth callback")?;
    let parameters: std::collections::HashMap<_, _> =
        callback_url.query_pairs().into_owned().collect();
    if parameters.get("state").map(String::as_str) != Some(expected_state) {
        return Err("OAuth state mismatch".into());
    }
    if let Some(error) = parameters.get("error") {
        return Err(format!("Authorization failed: {error}"));
    }
    parameters
        .get("code")
        .filter(|code| !code.is_empty())
        .cloned()
        .ok_or_else(|| "Authorization was not completed".into())
}

const CLI_SCOPES: &[&str] = &[
    "surveys:read",
    "surveys:write",
    "collections:write",
    "responses:read",
    "usage:read",
    "exports:read",
    "exports:write",
];

struct AuthorizationServer {
    authorization_endpoint: String,
    token_endpoint: String,
    revocation_endpoint: String,
}

fn authorization_server_metadata_url(issuer: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(issuer).map_err(|_| "Invalid OAuth issuer")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Invalid OAuth issuer".into());
    }
    let issuer_path = url.path().trim_matches('/');
    let metadata_path = if issuer_path.is_empty() {
        "/.well-known/oauth-authorization-server".to_owned()
    } else {
        format!("/.well-known/oauth-authorization-server/{issuer_path}")
    };
    url.set_path(&metadata_path);
    Ok(url)
}

fn https_endpoint(metadata: &Value, name: &str) -> Result<String, String> {
    let raw = metadata
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{} missing", name.replace('_', " ")))?;
    let url = reqwest::Url::parse(raw).map_err(|_| format!("Invalid {name}"))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(format!("Invalid {name}"));
    }
    Ok(raw.into())
}

fn validate_authorization_server(
    expected_issuer: &str,
    metadata: &Value,
) -> Result<AuthorizationServer, String> {
    if metadata.get("issuer").and_then(Value::as_str) != Some(expected_issuer) {
        return Err("Authorization-server issuer mismatch".into());
    }
    let string_array = |name: &str| -> Result<Vec<&str>, String> {
        metadata
            .get(name)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("{} missing", name.replace('_', " ")))?
            .iter()
            .map(|value| value.as_str().ok_or_else(|| format!("Invalid {name}")))
            .collect()
    };
    let grants = string_array("grant_types_supported")?;
    if !["authorization_code", "refresh_token"]
        .iter()
        .all(|required| grants.contains(required))
    {
        return Err(
            "Authorization server must support authorization_code and refresh_token".into(),
        );
    }
    if !string_array("code_challenge_methods_supported")?.contains(&"S256") {
        return Err("Authorization server must support PKCE S256".into());
    }
    let scopes = string_array("scopes_supported")?;
    if let Some(missing) = CLI_SCOPES.iter().find(|scope| !scopes.contains(scope)) {
        return Err(format!(
            "Authorization server does not advertise required scope {missing}"
        ));
    }
    Ok(AuthorizationServer {
        authorization_endpoint: https_endpoint(metadata, "authorization_endpoint")?,
        token_endpoint: https_endpoint(metadata, "token_endpoint")?,
        revocation_endpoint: https_endpoint(metadata, "revocation_endpoint")?,
    })
}

fn open_browser(url: &str) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    }
    .map_err(|_| "Cannot open the system browser")?;
    if status.success() {
        Ok(())
    } else {
        Err("Cannot open the system browser".into())
    }
}

fn oauth_login(base: &str) -> Result<(), String> {
    let client_id =
        env::var("LIKERTS_OAUTH_CLIENT_ID").map_err(|_| "Missing LIKERTS_OAUTH_CLIENT_ID")?;
    let mut no_input = Map::new();
    let protected_resource_url =
        endpoint(base, "/.well-known/oauth-protected-resource", &mut no_input)?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Cannot initialize HTTP client")?;
    let resource: Value = client
        .get(protected_resource_url)
        .send()
        .map_err(|_| "Cannot discover Likerts OAuth configuration")?
        .error_for_status()
        .map_err(|_| "Likerts OAuth discovery failed")?
        .json()
        .map_err(|_| "Invalid Likerts OAuth discovery")?;
    let issuer = resource
        .get("authorization_servers")
        .and_then(Value::as_array)
        .and_then(|v| v.first())
        .and_then(Value::as_str)
        .ok_or("OAuth authorization server missing")?;
    let resource_id = resource
        .get("resource")
        .and_then(Value::as_str)
        .ok_or("OAuth resource missing")?;
    let discovery_url = authorization_server_metadata_url(issuer)?;
    let discovery: Value = client
        .get(discovery_url)
        .send()
        .map_err(|_| "Cannot discover authorization server")?
        .error_for_status()
        .map_err(|_| "Authorization-server discovery failed")?
        .json()
        .map_err(|_| "Invalid authorization-server discovery")?;
    let server = validate_authorization_server(issuer, &discovery)?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "Cannot bind OAuth callback")?;
    let callback = format!(
        "http://127.0.0.1:{}/callback",
        listener
            .local_addr()
            .map_err(|_| "Cannot read OAuth callback")?
            .port()
    );
    let (verifier, challenge) = pkce_pair();
    let state = uuid::Uuid::new_v4().simple().to_string();
    let mut authorize = reqwest::Url::parse(&server.authorization_endpoint)
        .map_err(|_| "Invalid authorization endpoint")?;
    let requested_scopes = format!("openid offline_access {}", CLI_SCOPES.join(" "));
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &callback)
        .append_pair("scope", &requested_scopes)
        .append_pair("resource", resource_id)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("prompt", "consent");
    open_browser(authorize.as_str())?;
    eprintln!("Complete passwordless sign-in in your browser…");
    listener
        .set_nonblocking(false)
        .map_err(|_| "Cannot configure OAuth callback")?;
    let (mut stream, _) = listener.accept().map_err(|_| "OAuth callback failed")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(180)))
        .map_err(|_| "Cannot configure OAuth callback")?;
    let mut bytes = [0u8; 8192];
    let count =
        std::io::Read::read(&mut stream, &mut bytes).map_err(|_| "Cannot read OAuth callback")?;
    let request = String::from_utf8_lossy(&bytes[..count]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("Invalid OAuth callback")?;
    let code = oauth_callback_code(target, &state)?;
    use std::io::Write;
    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 49\r\nConnection: close\r\n\r\nLikerts sign-in complete. You may close this tab.");
    let token: Value = client
        .post(&server.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", callback.as_str()),
            ("code_verifier", verifier.as_str()),
            ("resource", resource_id),
        ])
        .send()
        .map_err(|_| "Token exchange failed")?
        .error_for_status()
        .map_err(|_| "Token exchange was rejected")?
        .json()
        .map_err(|_| "Invalid token response")?;
    save_credential(&StoredCredential {
        access_token: token
            .get("access_token")
            .and_then(Value::as_str)
            .ok_or("Access token missing")?
            .into(),
        refresh_token: token
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(str::to_owned),
        token_endpoint: server.token_endpoint,
        client_id,
        expires_at_unix: unix_now().saturating_add(
            token
                .get("expires_in")
                .and_then(Value::as_u64)
                .unwrap_or(300),
        ),
        revocation_endpoint: server.revocation_endpoint,
    })?;
    println!("Signed in. Credential stored with user-only permissions.");
    Ok(())
}
fn endpoint(
    base: &str,
    path: &str,
    input: &mut Map<String, Value>,
) -> Result<reqwest::Url, String> {
    let origin = reqwest::Url::parse(base).map_err(|_| "Invalid LIKERTS_API_URL")?;
    if !origin.username().is_empty()
        || origin.password().is_some()
        || origin.query().is_some()
        || origin.fragment().is_some()
        || origin.path() != "/"
    {
        return Err(
            "API URL must be an origin without credentials, path, query or fragment".into(),
        );
    }
    let loopback = matches!(origin.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if origin.scheme() != "https" && !(origin.scheme() == "http" && loopback) {
        return Err("HTTPS required except on loopback".into());
    }
    let mut path = path.to_string();
    if path.contains("{id}") {
        let value = input.remove("id").ok_or("Missing id")?;
        let id = value.as_str().ok_or("id must be a string")?;
        if id.is_empty()
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err("Invalid resource ID".into());
        }
        path = path.replace("{id}", id);
    }
    origin.join(&path).map_err(|_| "Invalid endpoint".into())
}
fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let capabilities = registry();
    if args.is_empty() || args[0] == "--help" {
        println!("likerts capabilities\nlikerts auth login|status|logout\nlikerts call <capability> [--input <file|->]\nCredentials: passwordless OAuth store or LIKERTS_TOKEN / LIKERTS_COLLECTION_TOKEN. Origin: LIKERTS_API_URL.");
        return Ok(());
    }
    if args.first().map(String::as_str) == Some("auth") {
        return match args.get(1).map(String::as_str) {
            Some("login") if args.len() == 2 => oauth_login(
                &env::var("LIKERTS_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
            ),
            Some("status") if args.len() == 2 => {
                load_credential()?;
                println!("Signed in with a stored OAuth credential.");
                Ok(())
            }
            Some("logout") if args.len() == 2 => {
                logout_credential_at(&credential_path()?)?;
                println!("Signed out locally.");
                Ok(())
            }
            _ => Err("Use likerts auth login|status|logout".into()),
        };
    }
    if args == ["capabilities"] {
        for c in capabilities {
            println!("{}\t{} {}\t{}", c.name, c.method, c.path, c.description);
        }
        return Ok(());
    }
    if args.len() < 2
        || args[0] != "call"
        || !(args.len() == 2 || (args.len() == 4 && args[2] == "--input"))
    {
        return Err("Use likerts call <capability> [--input <file|->]".into());
    }
    let operation = capabilities
        .iter()
        .find(|c| c.name == args[1])
        .ok_or("Unknown capability")?;
    let source = if args.len() == 4 {
        if args[3] == "-" {
            let mut s = String::new();
            io::stdin()
                .take(1_048_577)
                .read_to_string(&mut s)
                .map_err(|_| "Cannot read stdin")?;
            s
        } else {
            std::fs::read_to_string(&args[3]).map_err(|_| "Cannot read input file")?
        }
    } else {
        "{}".into()
    };
    if source.len() > 1_048_576 {
        return Err("Input exceeds 1 MiB".into());
    }
    let mut input: Map<String, Value> =
        serde_json::from_str(&source).map_err(|_| "Input must be a JSON object")?;
    let mut url = endpoint(
        &env::var("LIKERTS_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
        &operation.path,
        &mut input,
    )?;
    let key = if operation.auth == "collection" {
        "LIKERTS_COLLECTION_TOKEN"
    } else {
        "LIKERTS_TOKEN"
    };
    let token = match env::var(key) {
        Ok(token) => token,
        Err(_) if key == "LIKERTS_TOKEN" => stored_access_token()?,
        Err(_) => return Err(format!("Missing {key}")),
    };
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Cannot initialize HTTP client")?;
    let method = operation
        .method
        .parse::<reqwest::Method>()
        .map_err(|_| "Invalid bundled method")?;
    if method == reqwest::Method::GET {
        for (key, value) in &input {
            let value = match value {
                Value::String(value) => value.clone(),
                Value::Number(value) => value.to_string(),
                Value::Bool(value) => value.to_string(),
                _ => return Err("GET input values must be strings, numbers or booleans".into()),
            };
            url.query_pairs_mut().append_pair(key, &value);
        }
    }
    let mut request = client.request(method.clone(), url).bearer_auth(token);
    if operation.auth == "management" {
        if let Ok(workspace) = env::var("LIKERTS_WORKSPACE_ID") {
            if workspace.trim().is_empty() || workspace.chars().count() > 128 {
                return Err("Invalid LIKERTS_WORKSPACE_ID".into());
            }
            request = request.header("x-likerts-workspace", workspace);
        }
    }
    if method != reqwest::Method::GET {
        request = request.json(&input);
    }
    let response = request
        .send()
        .map_err(|_| "Request failed; check connectivity and API URL")?;
    if !response.status().is_success() {
        return Err(serde_json::json!({"error": {
            "code": "http_error",
            "message": format!("Likerts {} failed (HTTP {})", operation.name, response.status().as_u16()),
            "status": response.status().as_u16(),
            "operation": operation.name
        }}).to_string());
    }
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        println!("{{}}");
    } else {
        let data: Value = response
            .json()
            .map_err(|_| "Server returned invalid JSON")?;
        println!(
            "{}",
            serde_json::to_string_pretty(&data).map_err(|_| "Cannot format response")?
        );
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_credential_exfiltration_and_traversal() {
        assert!(endpoint("http://example.com", "/v1/usage", &mut Map::new()).is_err());
        assert!(endpoint("https://secret@example.com", "/v1/usage", &mut Map::new()).is_err());
        let mut input = Map::new();
        input.insert("id".into(), Value::String("../usage".into()));
        assert!(endpoint(
            "https://api.example.com",
            "/v1/collections/{id}",
            &mut input
        )
        .is_err());
    }
    #[test]
    fn binds_resource_and_removes_path_parameter() {
        let mut input = Map::new();
        input.insert("id".into(), Value::String("abc-123".into()));
        assert_eq!(
            endpoint("http://127.0.0.1:8080", "/v1/collections/{id}", &mut input)
                .unwrap()
                .as_str(),
            "http://127.0.0.1:8080/v1/collections/abc-123"
        );
        assert!(input.is_empty());
    }
    #[test]
    fn registry_has_unique_operations() {
        let entries = registry();
        let names: std::collections::HashSet<_> = entries.iter().map(|c| &c.name).collect();
        assert_eq!(names.len(), entries.len());
    }
    #[test]
    fn serializes_get_inputs_as_query_parameters() {
        let mut input = Map::new();
        input.insert("limit".into(), Value::from(25));
        input.insert("cursor".into(), Value::from("opaque"));
        let mut url = endpoint("https://api.example.com", "/v1/responses", &mut input).unwrap();
        for (key, value) in &input {
            let encoded = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            url.query_pairs_mut().append_pair(key, &encoded);
        }
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs.get("limit").map(String::as_str), Some("25"));
        assert_eq!(pairs.get("cursor").map(String::as_str), Some("opaque"));
    }

    fn test_credential() -> StoredCredential {
        StoredCredential {
            access_token: "access-one".into(),
            refresh_token: Some("refresh-one".into()),
            token_endpoint: "https://identity.example/oauth/token".into(),
            client_id: "cli-test".into(),
            expires_at_unix: 1_000,
            revocation_endpoint: "https://identity.example/oauth/revoke".into(),
        }
    }

    #[test]
    fn credential_store_is_private_atomic_and_removable() {
        let directory = std::env::temp_dir().join(format!(
            "likerts-cli-credential-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = directory.join("likerts").join("credentials.json");
        let credential = test_credential();
        save_credential_at(&path, &credential).unwrap();
        let loaded = load_credential_at(&path).unwrap();
        assert_eq!(loaded.access_token, "access-one");
        assert_eq!(loaded.refresh_token.as_deref(), Some("refresh-one"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let sibling_files = fs::read_dir(path.parent().unwrap()).unwrap().count();
        assert_eq!(sibling_files, 1, "atomic temporary file leaked");
        remove_credential_at(&path).unwrap();
        remove_credential_at(&path).unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn pkce_and_callback_state_are_bound() {
        let (verifier, challenge) = pkce_pair();
        assert!((43..=128).contains(&verifier.len()));
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );
        assert_eq!(
            oauth_callback_code("/callback?code=abc&state=expected", "expected"),
            Ok("abc".into())
        );
        assert_eq!(
            oauth_callback_code("/callback?code=abc&state=attacker", "expected"),
            Err("OAuth state mismatch".into())
        );
        assert_eq!(
            oauth_callback_code("/callback?error=access_denied&state=expected", "expected"),
            Err("Authorization failed: access_denied".into())
        );
        assert!(oauth_callback_code("/callback?state=expected", "expected").is_err());
    }

    #[test]
    fn clerk_style_authorization_metadata_is_strict_and_provider_neutral() {
        let issuer = "https://well-hagfish-71.clerk.accounts.dev";
        assert_eq!(
            authorization_server_metadata_url(issuer).unwrap().as_str(),
            "https://well-hagfish-71.clerk.accounts.dev/.well-known/oauth-authorization-server"
        );
        assert_eq!(
            authorization_server_metadata_url("https://identity.example/tenant")
                .unwrap()
                .as_str(),
            "https://identity.example/.well-known/oauth-authorization-server/tenant"
        );
        let scopes = CLI_SCOPES
            .iter()
            .copied()
            .chain(["openid", "offline_access"])
            .collect::<Vec<_>>();
        let metadata = serde_json::json!({
            "issuer": issuer,
            "authorization_endpoint": format!("{issuer}/oauth/authorize"),
            "token_endpoint": format!("{issuer}/oauth/token"),
            "revocation_endpoint": format!("{issuer}/oauth/revoke"),
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "scopes_supported": scopes
        });
        let server = validate_authorization_server(issuer, &metadata).unwrap();
        assert_eq!(server.token_endpoint, format!("{issuer}/oauth/token"));

        let mut wrong_issuer = metadata.clone();
        wrong_issuer["issuer"] = Value::String(format!("{issuer}/"));
        assert!(validate_authorization_server(issuer, &wrong_issuer).is_err());
        let mut no_pkce = metadata.clone();
        no_pkce["code_challenge_methods_supported"] = serde_json::json!(["plain"]);
        assert!(validate_authorization_server(issuer, &no_pkce).is_err());
        let mut missing_scope = metadata.clone();
        missing_scope["scopes_supported"] = serde_json::json!(["surveys:read"]);
        assert!(validate_authorization_server(issuer, &missing_scope).is_err());
        let mut insecure_endpoint = metadata;
        insecure_endpoint["token_endpoint"] = Value::String("http://identity.example/token".into());
        assert!(validate_authorization_server(issuer, &insecure_endpoint).is_err());
    }

    #[test]
    fn refresh_rotation_updates_access_and_preserves_or_rotates_refresh_token() {
        let mut credential = test_credential();
        apply_refresh_response(
            &mut credential,
            &serde_json::json!({"access_token":"access-two","expires_in":90}),
            5_000,
        )
        .unwrap();
        assert_eq!(credential.access_token, "access-two");
        assert_eq!(credential.refresh_token.as_deref(), Some("refresh-one"));
        assert_eq!(credential.expires_at_unix, 5_090);
        apply_refresh_response(
            &mut credential,
            &serde_json::json!({"access_token":"access-three","refresh_token":"refresh-two"}),
            6_000,
        )
        .unwrap();
        assert_eq!(credential.refresh_token.as_deref(), Some("refresh-two"));
        assert_eq!(credential.expires_at_unix, 6_300);
        assert!(apply_refresh_response(&mut credential, &serde_json::json!({}), 0).is_err());
    }

    #[test]
    fn logout_removes_local_credential_even_when_remote_revocation_fails() {
        let directory = std::env::temp_dir().join(format!(
            "likerts-cli-logout-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = directory.join("likerts").join("credentials.json");
        let mut credential = test_credential();
        credential.revocation_endpoint = "http://identity.example/oauth/revoke".into();
        save_credential_at(&path, &credential).unwrap();
        assert_eq!(
            logout_credential_at(&path),
            Err("Stored revocation endpoint must use HTTPS".into())
        );
        assert!(!path.exists());
        assert!(logout_credential_at(&path).is_ok());
        fs::remove_dir_all(directory).unwrap();
    }
}
