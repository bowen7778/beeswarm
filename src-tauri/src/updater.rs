use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use std::io::{Read, Write};
use sha2::{Sha256, Digest};
use base64::{Engine as _, engine::general_purpose};

// Public key for Ed25519 verification (Raw 32-byte Base64)
const PUBLIC_KEY_B64: &str = "ZWQogJnRNN3TcWcCF+CJrS3SoeKDiYWan9KisydfL4I=";

#[derive(Debug, Deserialize)]
pub struct UpdateMetadata {
    pub version: String,
    pub url: String,
    pub signature: String,
}

pub fn verify_signature(data: &[u8], signature_b64: &str) -> bool {
    let public_key_bytes = match general_purpose::STANDARD.decode(PUBLIC_KEY_B64) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let verifying_key = match VerifyingKey::from_bytes(public_key_bytes.as_slice().try_into().unwrap_or([0u8; 32])) {
        Ok(k) => k,
        Err(_) => return false,
    };

    let signature_bytes = match general_purpose::STANDARD.decode(signature_b64) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let signature = match Signature::from_slice(&signature_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };

    verifying_key.verify(data, &signature).is_ok()
}

pub async fn check_for_updates(current_version: &str, repo: &str) -> Option<UpdateMetadata> {
    let url = format!("https://github.com/{}/releases/download/baseline/latest.json", repo);
    let client = reqwest::Client::new();
    
    let resp = client.get(url).send().await.ok()?;
    let metadata: UpdateMetadata = resp.json().await.ok()?;

    if compare_versions(&metadata.version, current_version).is_gt() {
        Some(metadata)
    } else {
        None
    }
}

pub async fn download_and_extract(url: &str, target_dir: &Path, signature: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    // Verify signature
    if !verify_signature(&bytes, signature) {
        return Err("Invalid signature".to_string());
    }

    // Extract tar.gz
    let gz = flate2::read::GzDecoder::new(&bytes[..]);
    let mut archive = tar::Archive::new(gz);
    
    std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
    archive.unpack(target_dir).map_err(|e| e.to_string())?;

    Ok(())
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let left_parts: Vec<u32> = left.split('.').map(|part| part.parse::<u32>().unwrap_or(0)).collect();
    let right_parts: Vec<u32> = right.split('.').map(|part| part.parse::<u32>().unwrap_or(0)).collect();
    let max_len = left_parts.len().max(right_parts.len());

    for index in 0..max_len {
        let left_part = *left_parts.get(index).unwrap_or(&0);
        let right_part = *right_parts.get(index).unwrap_or(&0);
        match left_part.cmp(&right_part) {
            std::cmp::Ordering::Equal => continue,
            ordering => return ordering,
        }
    }

    std::cmp::Ordering::Equal
}
