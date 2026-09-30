use base64::Engine as _;
use rand::RngCore;
use sha2::{Digest, Sha256};

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn days_from_now(days: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::days(days)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// First instant of the current UTC month, same format as `now()` so text comparison orders correctly.
pub fn month_start() -> String {
    use chrono::Datelike;
    let n = chrono::Utc::now();
    format!("{:04}-{:02}-01T00:00:00.000Z", n.year(), n.month())
}

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// URL-safe random token with `bytes` of entropy.
pub fn token(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

pub fn sha256_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}
