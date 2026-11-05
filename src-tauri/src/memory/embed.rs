use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokenizers::Tokenizer;

const MODEL_DIR: &str = "models/minilm-l6-v2";
const HF_BASE: &str = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";

#[derive(Clone, Copy)]
struct ModelFile {
    name: &'static str,
    remote: &'static str,
    bytes: u64,
    sha256: &'static str,
}

const FILES: [ModelFile; 2] = [
    ModelFile {
        name: "model_quantized.onnx",
        remote: "onnx/model_quantized.onnx",
        bytes: 22_972_370,
        sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
    },
    ModelFile {
        name: "tokenizer.json",
        remote: "tokenizer.json",
        bytes: 711_661,
        sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    },
];

struct Embedder {
    tokenizer: Tokenizer,
    session: ort::session::Session,
    hidden: usize,
}

static MODEL: OnceLock<Mutex<Option<Embedder>>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
pub struct ModelStatus {
    pub installed: bool,
    pub bytes: u64,
    pub dir: String,
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("app local data dir: {error}"))?;
    Ok(base.join(MODEL_DIR))
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn file_ok(path: &PathBuf, file: ModelFile) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => meta.len() == file.bytes,
        Err(_) => false,
    }
}

/// A same-size corrupt file would otherwise be trusted forever, so an existing
/// model file is hashed before `install` skips it.
fn file_matches(path: &PathBuf, file: ModelFile) -> bool {
    if !file_ok(path, file) {
        return false;
    }
    match std::fs::read(path) {
        Ok(bytes) => sha256(&bytes) == file.sha256,
        Err(_) => false,
    }
}

pub fn status(app: &AppHandle) -> ModelStatus {
    let dir = dir(app).unwrap_or_default();
    let installed = FILES
        .iter()
        .all(|file| file_ok(&dir.join(file.name), *file));
    let bytes = FILES
        .iter()
        .filter_map(|file| std::fs::metadata(dir.join(file.name)).ok())
        .map(|meta| meta.len())
        .sum();
    ModelStatus {
        installed,
        bytes,
        dir: dir.to_string_lossy().to_string(),
    }
}

pub fn available(app: &AppHandle) -> bool {
    status(app).installed
}

pub async fn install(app: &AppHandle, client: &reqwest::Client) -> Result<ModelStatus, String> {
    let dir = dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("create {dir:?}: {error}"))?;
    for file in FILES {
        let target = dir.join(file.name);
        if file_matches(&target, file) {
            continue;
        }
        let url = format!("{HF_BASE}/{}", file.remote);
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("download {url}: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("download {url}: HTTP {}", response.status()));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("read {url}: {error}"))?;
        if bytes.len() as u64 != file.bytes {
            return Err(format!(
                "{}: expected {} bytes, got {}",
                file.name,
                file.bytes,
                bytes.len()
            ));
        }
        let digest = sha256(&bytes);
        if digest != file.sha256 {
            return Err(format!("{}: checksum mismatch", file.name));
        }
        let temp = target.with_extension("tmp");
        std::fs::write(&temp, &bytes).map_err(|error| format!("write {temp:?}: {error}"))?;
        std::fs::rename(&temp, &target).map_err(|error| format!("rename {temp:?}: {error}"))?;
    }
    Ok(status(app))
}

fn load_into(slot: &mut Option<Embedder>, app: &AppHandle) -> Result<(), String> {
    if slot.is_some() {
        return Ok(());
    }
    let dir = dir(app)?;
    let tokenizer_path = dir.join("tokenizer.json");
    let model_path = dir.join("model_quantized.onnx");
    if !tokenizer_path.is_file() || !model_path.is_file() {
        return Err("the memory search model is not installed".to_string());
    }
    let tokenizer =
        Tokenizer::from_file(&tokenizer_path).map_err(|error| format!("tokenizer: {error}"))?;
    let session = transcribe_rs::onnx::session::create_session(&model_path)
        .map_err(|error| format!("model: {error}"))?;
    *slot = Some(Embedder {
        tokenizer,
        session,
        hidden: 384,
    });
    Ok(())
}

fn mean_pool(data: &[f32], shape: &[i64], mask: &[i64], hidden: usize) -> Vec<Vec<f32>> {
    let batch = shape[0] as usize;
    let seq = shape[1] as usize;
    let mut out = Vec::with_capacity(batch);
    for b in 0..batch {
        let mut vector = vec![0.0f32; hidden];
        let mut count = 0.0f32;
        for t in 0..seq {
            if mask[b * seq + t] == 0 {
                continue;
            }
            count += 1.0;
            for h in 0..hidden {
                vector[h] += data[(b * seq + t) * hidden + h];
            }
        }
        if count > 0.0 {
            for value in &mut vector {
                *value /= count;
            }
        }
        let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
        if norm > 0.0 {
            for value in &mut vector {
                *value /= norm;
            }
        }
        out.push(vector);
    }
    out
}

pub fn embed_texts(app: &AppHandle, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let guard = MODEL.get_or_init(|| Mutex::new(None));
    let mut slot = guard.lock().unwrap_or_else(|error| error.into_inner());
    load_into(&mut slot, app)?;
    let Some(model) = slot.as_mut() else {
        return Err("the memory search model is not loaded".to_string());
    };
    run_model(model, texts)
}

/// Non-blocking variant for automatic recall. If the model is busy embedding
/// notes, this turn falls back to keyword ranking instead of waiting.
pub fn try_embed_query(app: &AppHandle, text: &str) -> Option<Vec<f32>> {
    let guard = MODEL.get_or_init(|| Mutex::new(None));
    let mut slot = guard.try_lock().ok()?;
    if load_into(&mut slot, app).is_err() {
        return None;
    }
    let model = slot.as_mut()?;
    run_model(model, &[text.to_string()]).ok()?.pop()
}

fn run_model(model: &mut Embedder, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let encodings = model
        .tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|error| error.to_string())?;
    let max_len = encodings
        .iter()
        .map(|encoding| encoding.get_ids().len())
        .max()
        .unwrap_or(1);
    let batch = texts.len();
    let mut ids = vec![0i64; batch * max_len];
    let mut mask = vec![0i64; batch * max_len];
    for (b, encoding) in encodings.iter().enumerate() {
        for (t, id) in encoding.get_ids().iter().enumerate() {
            ids[b * max_len + t] = *id as i64;
            mask[b * max_len + t] = 1;
        }
    }
    let ids_tensor = ort::value::Tensor::from_array(([batch, max_len], ids))
        .map_err(|error| error.to_string())?;
    let mask_tensor = ort::value::Tensor::from_array(([batch, max_len], mask.clone()))
        .map_err(|error| error.to_string())?;
    let types = ort::value::Tensor::from_array(([batch, max_len], vec![0i64; batch * max_len]))
        .map_err(|error| error.to_string())?;
    let outputs = model
        .session
        .run(ort::inputs![
            "input_ids" => ids_tensor,
            "attention_mask" => mask_tensor,
            "token_type_ids" => types,
        ])
        .map_err(|error| error.to_string())?;
    let output = outputs
        .get("last_hidden_state")
        .ok_or_else(|| "model returned no last_hidden_state".to_string())?;
    let (shape, data) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| error.to_string())?;
    Ok(mean_pool(data, shape, &mask, model.hidden))
}

pub fn encode(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

pub fn decode(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect()
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(left, right)| left * right).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vectors_round_trip_through_bytes() {
        let vector = vec![0.25f32, -1.5, 3.0];
        let bytes = encode(&vector);
        assert_eq!(decode(&bytes), vector);
    }

    #[test]
    fn cosine_is_one_for_the_same_unit_vector() {
        let vector = vec![0.6f32, 0.8];
        assert!((cosine(&vector, &vector) - 1.0).abs() < 0.0001);
    }
}
