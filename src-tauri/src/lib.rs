//! THREAD desktop host.
//!
//! The frontend never touches the file system directly: every vault operation
//! goes through these commands, which confine paths to the chosen vault root.
//! Binary files travel as raw IPC bodies/responses instead of JSON arrays.

mod google;

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;
use tauri::ipc::{InvokeBody, Request, Response};

#[derive(Serialize)]
struct Entry {
    path: String,
    dir: bool,
    size: u64,
    mtime: f64,
}

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Resolve a vault-relative path, refusing anything that escapes the root.
fn resolve(root: &str, rel: &str) -> CmdResult<PathBuf> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("vault root is not a directory: {}", root.display()));
    }
    let rel_path = Path::new(rel);
    for c in rel_path.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("path escapes the vault: {rel}")),
        }
    }
    Ok(root.join(rel_path))
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<Entry>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".git" || name == "node_modules" || name == ".loom" {
            continue;
        }
        let path = entry.path();
        let meta = entry.metadata()?;
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);
        out.push(Entry { path: rel, dir: meta.is_dir(), size: meta.len(), mtime });
        if meta.is_dir() {
            walk(root, &path, out)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn vault_list(root: String) -> CmdResult<Vec<Entry>> {
    let root_path = PathBuf::from(&root);
    let mut out = Vec::new();
    walk(&root_path, &root_path, &mut out).map_err(err)?;
    Ok(out)
}

#[tauri::command]
fn vault_read_text(root: String, path: String) -> CmdResult<String> {
    fs::read_to_string(resolve(&root, &path)?).map_err(err)
}

#[tauri::command]
fn vault_write_text(root: String, path: String, text: String) -> CmdResult<()> {
    let p = resolve(&root, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    // Write to a sibling temp file, then rename: a crash never leaves half a Thread.
    let tmp = p.with_extension("thread-tmp");
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, &p).map_err(err)
}

#[tauri::command]
fn vault_read_binary(root: String, path: String) -> CmdResult<Response> {
    Ok(Response::new(fs::read(resolve(&root, &path)?).map_err(err)?))
}

fn header(request: &Request<'_>, name: &str) -> CmdResult<String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing header {name}"))?
        .to_str()
        .map_err(err)?;
    Ok(percent_decode(raw))
}

fn body(request: &Request<'_>) -> CmdResult<Vec<u8>> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("expected a raw binary body".into()),
    }
}

#[tauri::command]
fn vault_write_binary(request: Request<'_>) -> CmdResult<()> {
    let p = resolve(&header(&request, "x-root")?, &header(&request, "x-path")?)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(p, body(&request)?).map_err(err)
}

#[tauri::command]
fn vault_remove(root: String, path: String) -> CmdResult<()> {
    let p = resolve(&root, &path)?;
    if p == Path::new(&root) {
        return Err("refusing to delete the vault root".into());
    }
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(err)
    } else if p.exists() {
        fs::remove_file(p).map_err(err)
    } else {
        Ok(())
    }
}

#[tauri::command]
fn vault_rename(root: String, from: String, to: String) -> CmdResult<()> {
    let a = resolve(&root, &from)?;
    let b = resolve(&root, &to)?;
    if b.exists() {
        return Err(format!("{to} already exists"));
    }
    if let Some(parent) = b.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(a, b).map_err(err)
}

#[tauri::command]
fn vault_mkdir(root: String, path: String) -> CmdResult<()> {
    fs::create_dir_all(resolve(&root, &path)?).map_err(err)
}

#[tauri::command]
fn vault_exists(root: String, path: String) -> CmdResult<bool> {
    Ok(resolve(&root, &path)?.exists())
}

/// Write an exported manuscript to the absolute path the user picked in the save dialog.
#[tauri::command]
fn save_export(request: Request<'_>) -> CmdResult<()> {
    let target = PathBuf::from(header(&request, "x-path")?);
    if !target.is_absolute() {
        return Err("export target must be an absolute path from the save dialog".into());
    }
    fs::write(target, body(&request)?).map_err(err)
}

/// A vault passed on the command line (`thread ~/Worlds`) or via THREAD_VAULT.
#[tauri::command]
fn startup_vault() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .or_else(|| std::env::var("THREAD_VAULT").ok())
        .filter(|p| Path::new(p).is_dir())
        .and_then(|p| fs::canonicalize(p).ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Mobile: write an export into the shared Download/THREAD folder; returns where it went.
#[tauri::command]
fn save_to_downloads(app: tauri::AppHandle, request: Request<'_>) -> CmdResult<String> {
    let name = header(&request, "x-name")?;
    if name.contains(['/', '\\']) || name.starts_with('.') {
        return Err("invalid file name".into());
    }
    #[cfg(target_os = "android")]
    let base = { let _ = &app; PathBuf::from("/storage/emulated/0/Download") };
    #[cfg(not(target_os = "android"))]
    let base = {
        use tauri::Manager;
        app.path().download_dir().map_err(err)?
    };
    let dir = base.join("THREAD");
    fs::create_dir_all(&dir).map_err(err)?;
    let target = dir.join(&name);
    fs::write(&target, body(&request)?).map_err(err)?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
fn pandoc_available() -> bool {
    Command::new("pandoc").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

/// Typeset with Pandoc on the host (the heavy-duty Compiler path).
#[tauri::command]
fn pandoc_convert(markdown: String, format: String) -> CmdResult<Response> {
    let ext = match format.as_str() {
        "pdf" | "docx" | "epub" | "odt" => format.as_str(),
        _ => return Err(format!("unsupported format {format}")),
    };
    let dir = std::env::temp_dir().join(format!("thread-pandoc-{}", std::process::id()));
    fs::create_dir_all(&dir).map_err(err)?;
    let input = dir.join("manuscript.md");
    let output = dir.join(format!("manuscript.{ext}"));
    fs::write(&input, markdown).map_err(err)?;
    let mut cmd = Command::new("pandoc");
    cmd.arg(&input).arg("-o").arg(&output).arg("--standalone");
    if ext == "pdf" || ext == "docx" || ext == "odt" {
        cmd.arg("--top-level-division=chapter");
    }
    let result = cmd.output().map_err(|e| format!("could not run pandoc: {e}"))?;
    if !result.status.success() {
        let _ = fs::remove_dir_all(&dir);
        return Err(String::from_utf8_lossy(&result.stderr).into_owned());
    }
    let bytes = fs::read(&output).map_err(err)?;
    let _ = fs::remove_dir_all(&dir);
    Ok(Response::new(bytes))
}

/// Minimal percent-decoding for header values produced by `encodeURIComponent`.
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            vault_list,
            vault_read_text,
            vault_write_text,
            vault_read_binary,
            vault_write_binary,
            vault_remove,
            vault_rename,
            vault_mkdir,
            vault_exists,
            save_export,
            startup_vault,
            save_to_downloads,
            pandoc_available,
            pandoc_convert,
            google::google_oauth_start,
            google::google_oauth_refresh
        ])
        .run(tauri::generate_context!())
        .expect("error while running THREAD");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_rejects_escapes() {
        let root = std::env::temp_dir();
        let root = root.to_str().unwrap();
        assert!(resolve(root, "a/b.md").is_ok());
        assert!(resolve(root, "../etc/passwd").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "a/../../x").is_err());
    }

    #[test]
    fn decodes_headers() {
        assert_eq!(percent_decode("My%20Vault%2FNotes.md"), "My Vault/Notes.md");
        assert_eq!(percent_decode("%E2%9C%A6"), "✦");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
