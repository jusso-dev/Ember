//! Secret encryption (AES-256-GCM) and TOTP helpers.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha1::Sha1;
use sha2::{Digest, Sha256};

type HmacSha1 = Hmac<Sha1>;

/// Derive a 32-byte key from EMBER_SECRETS_KEY or a stable default for lab use.
pub fn secrets_key() -> [u8; 32] {
    let raw = std::env::var("EMBER_SECRETS_KEY").unwrap_or_else(|_| {
        tracing::warn!("EMBER_SECRETS_KEY unset; using derived lab default (set in production)");
        "ember-lab-secrets-key-change-me".into()
    });
    let digest = Sha256::digest(raw.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

pub fn encrypt_secret(plaintext: &str) -> anyhow::Result<String> {
    let key = secrets_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow::anyhow!("encrypt: {e}"))?;
    let mut out = nonce_bytes.to_vec();
    out.extend_from_slice(&ciphertext);
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        out,
    ))
}

pub fn decrypt_secret(blob_b64: &str) -> anyhow::Result<String> {
    let raw = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, blob_b64)?;
    if raw.len() < 13 {
        anyhow::bail!("ciphertext too short");
    }
    let (nonce_bytes, ct) = raw.split_at(12);
    let key = secrets_key();
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ct)
        .map_err(|e| anyhow::anyhow!("decrypt: {e}"))?;
    Ok(String::from_utf8(plain)?)
}

/// Generate a 20-byte base32 secret for TOTP.
pub fn generate_totp_secret() -> String {
    let mut bytes = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut bytes);
    base32_encode(&bytes)
}

pub fn totp_code(secret_b32: &str, unix_secs: u64) -> anyhow::Result<String> {
    let key = base32_decode(secret_b32)?;
    let counter = unix_secs / 30;
    let mut msg = [0u8; 8];
    msg.copy_from_slice(&counter.to_be_bytes());
    let mut mac = <HmacSha1 as Mac>::new_from_slice(&key)?;
    mac.update(&msg);
    let hash = mac.finalize().into_bytes();
    let offset = (hash[19] & 0x0f) as usize;
    let bin = ((hash[offset] as u32 & 0x7f) << 24)
        | ((hash[offset + 1] as u32) << 16)
        | ((hash[offset + 2] as u32) << 8)
        | (hash[offset + 3] as u32);
    Ok(format!("{:06}", bin % 1_000_000))
}

pub fn verify_totp(secret_b32: &str, code: &str) -> bool {
    let code = code.trim();
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    for skew in [0i64, -1, 1] {
        let t = if skew >= 0 {
            now.saturating_add((skew as u64) * 30)
        } else {
            now.saturating_sub(((-skew) as u64) * 30)
        };
        if let Ok(expected) = totp_code(secret_b32, t) {
            if expected == code {
                return true;
            }
        }
    }
    false
}

pub fn otpauth_url(email: &str, secret_b32: &str) -> String {
    format!(
        "otpauth://totp/Ember:{}?secret={}&issuer=Ember&digits=6&period=30",
        urlencoding_lite(email),
        secret_b32
    )
}

fn urlencoding_lite(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

fn base32_encode(data: &[u8]) -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut out = String::new();
    for &b in data {
        value = (value << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(ALPHA[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(ALPHA[((value << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn base32_decode(s: &str) -> anyhow::Result<Vec<u8>> {
    let s = s.trim().to_uppercase().replace('=', "");
    let mut bits = 0u32;
    let mut value = 0u32;
    let mut out = Vec::new();
    for c in s.chars() {
        let v = match c {
            'A'..='Z' => c as u32 - 'A' as u32,
            '2'..='7' => c as u32 - '2' as u32 + 26,
            _ => anyhow::bail!("invalid base32"),
        };
        value = (value << 5) | v;
        bits += 5;
        if bits >= 8 {
            out.push(((value >> (bits - 8)) & 0xff) as u8);
            bits -= 8;
        }
    }
    Ok(out)
}
