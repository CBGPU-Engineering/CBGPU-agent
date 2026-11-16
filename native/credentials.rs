use crate::{
    Failure, Result,
    api::{ENDPOINT, endpoint},
};
use serde_json::json;
use std::path::{Path, PathBuf};
pub fn path() -> Result<PathBuf> {
    Ok(dirs::home_dir()
        .ok_or_else(|| Failure::new("Home directory unavailable."))?
        .join(".config/cbgpu-agent/credentials.json"))
}
pub fn valid(key: &str) -> bool {
    key.starts_with("cbgpu_ai_")
        && key.len() > 9
        && key.len() < 4096
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
fn inspect(path: &Path, directory: bool) -> Result<()> {
    let m = std::fs::symlink_metadata(path).map_err(|_| {
        Failure::new("Run cbgpu login first. Create a key at https://cbgpu.com/ai?tab=api")
    })?;
    if m.file_type().is_symlink() || if directory { !m.is_dir() } else { !m.is_file() } {
        return Err(Failure::new("Unsafe credential path."));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if m.uid() != unsafe { libc::geteuid() }
            || (!directory && m.permissions().mode() & 0o077 != 0)
        {
            return Err(Failure::new("Credential file must be private (chmod 600)."));
        }
    }
    Ok(())
}
fn secure(path: &Path, directory: bool) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            path,
            std::fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
        )
        .map_err(|_| Failure::new("Cannot secure credential storage."))?;
    }
    #[cfg(windows)]
    {
        let identity = std::process::Command::new("whoami.exe")
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .map_err(|_| Failure::new("Windows identity unavailable."))?;
        let text = String::from_utf8_lossy(&identity.stdout);
        let regex = regex::Regex::new(r"S-\d-\d+(?:-\d+)+").unwrap();
        let sid = regex
            .find(&text)
            .ok_or_else(|| Failure::new("Windows identity unavailable."))?
            .as_str();
        let grant = format!("*{sid}:{}F", if directory { "(OI)(CI)" } else { "" });
        for options in [
            vec!["/reset"],
            vec!["/inheritance:r"],
            vec!["/grant:r", grant.as_str()],
        ] {
            if !std::process::Command::new("icacls.exe")
                .arg(path)
                .args(options)
                .output()
                .map_err(|_| Failure::new("Cannot secure Windows credential ACL."))?
                .status
                .success()
            {
                return Err(Failure::new("Cannot secure Windows credential ACL."));
            }
        }
    }
    Ok(())
}
pub fn read(file: &Path, base: &str) -> Result<String> {
    inspect(file, false)?;
    #[cfg(windows)]
    secure(file, false)?;
    use std::io::Read;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let handle = options
        .open(file)
        .map_err(|_| Failure::new("Cannot read credential file."))?;
    let mut bytes = Vec::new();
    handle
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| Failure::new("Cannot read credential file."))?;
    if bytes.len() > 65536 {
        return Err(Failure::new("Invalid credential file."));
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| Failure::new("Invalid credential file. Run cbgpu login."))?;
    let bound = value["base"].as_str().unwrap_or(ENDPOINT);
    if endpoint(bound)? != endpoint(base)? {
        return Err(Failure::new(
            "Saved key belongs to a different API endpoint. Log in to the selected endpoint or explicitly supply CBGPU_API_KEY.",
        ));
    }
    value["key"]
        .as_str()
        .filter(|k| valid(k))
        .map(String::from)
        .ok_or_else(|| Failure::new("Invalid saved key. Run cbgpu login."))
}
pub fn save(file: &Path, key: &str, base: &str) -> Result<()> {
    if !valid(key) {
        return Err(Failure::new("Use an API key from CBGPU AI → API."));
    }
    let parent = file
        .parent()
        .ok_or_else(|| Failure::new("Credential directory unavailable."))?;
    std::fs::create_dir_all(parent)
        .map_err(|_| Failure::new("Cannot create credential directory."))?;
    inspect(parent, true)?;
    secure(parent, true)?;
    use std::io::Write;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| Failure::new("Cannot stage private credentials."))?;
    secure(temp.path(), false)?;
    serde_json::to_writer(&mut temp, &json!({"key":key,"base":endpoint(base)?}))
        .map_err(|_| Failure::new("Cannot encode credentials."))?;
    temp.write_all(b"\n")
        .map_err(|_| Failure::new("Cannot save credentials."))?;
    temp.as_file()
        .sync_all()
        .map_err(|_| Failure::new("Cannot save credentials."))?;
    temp.persist(file)
        .map_err(|_| Failure::new("Cannot atomically save credentials."))?;
    Ok(())
}
pub fn remove(file: &Path) -> Result<()> {
    if file.exists() {
        inspect(file, false)?;
        std::fs::remove_file(file)
            .map_err(|_| Failure::new("Cannot remove local credential file."))?;
    }
    Ok(())
}
