//! Google OAuth for the desktop app (RFC 8252: loopback redirect + PKCE).
//!
//! Google refuses sign-in inside embedded webviews, so the consent page
//! opens in the system browser and redirects back to a one-shot listener on
//! 127.0.0.1. The code is exchanged here so the webview never needs CORS
//! access to Google's token endpoint.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri_plugin_opener::OpenerExt;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const WAIT: Duration = Duration::from_secs(300);

fn random_b64(len: usize) -> Result<String, String> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).map_err(|e| e.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Pull `code` out of the redirect's request line, checking `state`.
pub fn parse_redirect(request_line: &str, expected_state: &str) -> Result<String, String> {
    let target = request_line.split_whitespace().nth(1).ok_or("malformed redirect")?;
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let v = crate::percent_decode(&v.replace('+', " "));
        match k {
            "code" => code = Some(v),
            "state" => state = Some(v),
            "error" => error = Some(v),
            _ => {}
        }
    }
    if let Some(e) = error {
        return Err(format!("Google sign-in failed: {e}"));
    }
    if state.as_deref() != Some(expected_state) {
        return Err("sign-in state mismatch".into());
    }
    code.ok_or_else(|| "no authorization code in redirect".into())
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().try_proxy_from_env(true).timeout(Duration::from_secs(30)).build()
}

fn token_request(form: &[(&str, &str)]) -> Result<Value, String> {
    match agent().post(TOKEN_URL).send_form(form) {
        Ok(res) => res.into_json::<Value>().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(code, res)) => Err(format!("token endpoint {code}: {}", res.into_string().unwrap_or_default())),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn google_oauth_start(app: tauri::AppHandle, client_id: String, client_secret: String, scope: String) -> Result<Value, String> {
    let verifier = random_b64(48)?;
    let state = random_b64(16)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let url = format!(
        "{AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        encode(&client_id),
        encode(&redirect),
        encode(&scope),
        pkce_challenge(&verifier),
        encode(&state)
    );
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;

    let code = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let start = Instant::now();
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let line = req.lines().next().unwrap_or("");
                    // Browsers also ask for /favicon.ico; ignore anything without a query.
                    if !line.contains('?') {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                        continue;
                    }
                    let result = parse_redirect(line, &state);
                    let body = match &result {
                        Ok(_) => "<h2 style='font-family:sans-serif'>THREAD is connected to Google Calendar.</h2><p style='font-family:sans-serif'>You can close this tab.</p>",
                        Err(_) => "<h2 style='font-family:sans-serif'>Sign-in did not complete.</h2><p style='font-family:sans-serif'>Return to THREAD and try again.</p>",
                    };
                    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    return result;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if start.elapsed() > WAIT {
                        return Err("timed out waiting for Google sign-in".into());
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    tauri::async_runtime::spawn_blocking(move || {
        let mut form = vec![
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier.as_str()),
        ];
        if !client_secret.is_empty() {
            form.push(("client_secret", client_secret.as_str()));
        }
        token_request(&form)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn google_oauth_refresh(client_id: String, client_secret: String, refresh_token: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut form = vec![("client_id", client_id.as_str()), ("refresh_token", refresh_token.as_str()), ("grant_type", "refresh_token")];
        if !client_secret.is_empty() {
            form.push(("client_secret", client_secret.as_str()));
        }
        token_request(&form)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn parses_redirects() {
        assert_eq!(parse_redirect("GET /?state=abc&code=4%2F0Ab-x HTTP/1.1", "abc").unwrap(), "4/0Ab-x");
        assert!(parse_redirect("GET /?state=evil&code=x HTTP/1.1", "abc").is_err());
        assert!(parse_redirect("GET /?error=access_denied&state=abc HTTP/1.1", "abc").unwrap_err().contains("access_denied"));
    }

    #[test]
    fn encodes_query_values() {
        assert_eq!(encode("http://127.0.0.1:5/a b"), "http%3A%2F%2F127.0.0.1%3A5%2Fa%20b");
    }
}
