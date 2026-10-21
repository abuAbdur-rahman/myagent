use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use transcribe_rs::onnx::Quantization;
use transcribe_rs::onnx::moonshine::{MoonshineModel, MoonshineParams, MoonshineVariant};

use crate::error::{AppError, AppResult};
use crate::{connections, vault};

const MODEL_DIR: &str = "models/moonshine-base";
const HF_BASE: &str = "https://huggingface.co/onnx-community/moonshine-base-ONNX/resolve/main";
const MODEL_FILES: [(&str, &str, u64, &str); 3] = [
    (
        "encoder_model.int8.onnx",
        "onnx/encoder_model_int8.onnx",
        20_488_801,
        "4edb38db96b52ddee5a3b25d2211bb6394f9a9a2d95f67bce0e8c861da018a4d",
    ),
    (
        "decoder_model_merged.int8.onnx",
        "onnx/decoder_model_merged_int8.onnx",
        42_427_261,
        "45febab0347ffbe1326459e092ae20a2cfda10ca33ab018b3c299247284de61b",
    ),
    (
        "tokenizer.json",
        "tokenizer.json",
        3_761_754,
        "7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f",
    ),
];
const SAMPLE_RATE: u32 = 16_000;
const MAX_SECONDS: usize = 60;
const MIN_SECONDS: f32 = 0.2;
const IDLE_UNLOAD: Duration = Duration::from_secs(300);
const PROGRESS_STEP: u64 = 256 * 1024;
const MAX_REMOTE_BYTES: usize = 1024 * 1024;

static ENABLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static MODEL: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();
static UNLOAD_GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct VoiceConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct VoiceFile {
    pub name: String,
    pub bytes: u64,
    pub expected: u64,
}

#[derive(Serialize, Clone)]
pub struct VoiceStatus {
    pub enabled: bool,
    pub ready: bool,
    pub model_dir: String,
    pub bytes: u64,
    pub expected: u64,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub files: Vec<VoiceFile>,
}

#[derive(Serialize, Clone)]
pub struct VoiceProgress {
    pub file: String,
    pub done: u64,
    pub total: u64,
}

#[derive(Serialize)]
pub struct Transcript {
    pub text: String,
    pub ms: u64,
}

struct Loaded {
    model: MoonshineModel,
    used: Instant,
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("voice.json"))
}

fn config(app: &AppHandle) -> VoiceConfig {
    let Some(path) = config_path(app) else {
        return VoiceConfig::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(cfg) => cfg,
            Err(error) => {
                eprintln!("voice: cannot parse config: {error}");
                VoiceConfig::default()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => VoiceConfig::default(),
        Err(error) => {
            eprintln!("voice: cannot read config: {error}");
            VoiceConfig::default()
        }
    }
}

fn save(app: &AppHandle, cfg: &VoiceConfig) -> AppResult<()> {
    let path = config_path(app)
        .ok_or_else(|| AppError::Internal("app data directory unavailable".to_string()))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| AppError::Internal(format!("voice config: {e}")))?;
    }
    let text = serde_json::to_string_pretty(cfg)
        .map_err(|e| AppError::Internal(format!("voice config: {e}")))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| AppError::Internal(format!("voice config: {e}")))?;
    std::fs::rename(&tmp, &path).map_err(|e| AppError::Internal(format!("voice config: {e}")))
}

fn model_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .resolve(MODEL_DIR, BaseDirectory::AppLocalData)
        .unwrap_or_else(|_| PathBuf::from(MODEL_DIR))
}

fn model_ready(dir: &Path) -> bool {
    MODEL_FILES.iter().all(|(name, _, size, _)| {
        std::fs::metadata(dir.join(name))
            .map(|meta| meta.len() == *size)
            .unwrap_or(false)
    })
}

pub fn is_enabled(app: &AppHandle) -> bool {
    config(app).enabled
}

fn status(app: &AppHandle) -> VoiceStatus {
    let cfg = config(app);
    let dir = model_dir(app);
    let mut files = Vec::new();
    let mut bytes = 0;
    let mut expected = 0;
    for (name, _, size, _) in MODEL_FILES {
        let actual = std::fs::metadata(dir.join(name))
            .map(|meta| meta.len())
            .unwrap_or(0);
        bytes += actual;
        expected += size;
        files.push(VoiceFile {
            name: name.to_string(),
            bytes: actual,
            expected: size,
        });
    }
    let ready = cfg.provider.is_some() || bytes == expected;
    VoiceStatus {
        enabled: cfg.enabled,
        ready,
        model_dir: dir.to_string_lossy().into_owned(),
        bytes,
        expected,
        provider: cfg.provider,
        model: cfg.model,
        files,
    }
}

#[tauri::command]
pub fn voice_status(app: AppHandle) -> VoiceStatus {
    status(&app)
}

#[tauri::command]
pub async fn voice_enable(
    app: AppHandle,
    client: State<'_, reqwest::Client>,
) -> AppResult<VoiceStatus> {
    let _guard = ENABLE.lock().await;
    let mut cfg = config(&app);
    if cfg.provider.is_none() {
        ensure_model(&app, client.inner()).await?;
    }
    cfg.enabled = true;
    save(&app, &cfg)?;
    Ok(status(&app))
}

#[tauri::command]
pub fn voice_disable(app: AppHandle) -> AppResult<VoiceStatus> {
    let mut cfg = config(&app);
    cfg.enabled = false;
    save(&app, &cfg)?;
    unload_model();
    Ok(status(&app))
}

#[tauri::command]
pub async fn voice_set_provider(
    app: AppHandle,
    provider: Option<String>,
    model: Option<String>,
) -> AppResult<VoiceStatus> {
    let mut cfg = config(&app);
    match provider {
        Some(id) => {
            let base_url = connections::base_url_for(&app, &id).await?;
            endpoint_url(&base_url)?;
            let model = model
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::Internal("a transcription model is required".to_string())
                })?;
            cfg.provider = Some(id);
            cfg.model = Some(model);
        }
        None => {
            cfg.provider = None;
            cfg.model = None;
        }
    }
    save(&app, &cfg)?;
    Ok(status(&app))
}

async fn ensure_model(app: &AppHandle, client: &reqwest::Client) -> AppResult<()> {
    let dir = model_dir(app);
    download_model(client, &dir, |progress| {
        let _ = app.emit("voice_progress", progress);
    })
    .await
}

async fn download_model(
    client: &reqwest::Client,
    dir: &Path,
    on_progress: impl Fn(VoiceProgress),
) -> AppResult<()> {
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| AppError::Internal(format!("voice model dir: {e}")))?;
    for (name, remote, expected, sha) in MODEL_FILES {
        let dest = dir.join(name);
        if std::fs::metadata(&dest)
            .map(|meta| meta.len() == expected)
            .unwrap_or(false)
        {
            continue;
        }
        download_file(client, dir, name, remote, expected, sha, &on_progress).await?;
    }
    on_progress(VoiceProgress {
        file: "done".to_string(),
        done: 1,
        total: 1,
    });
    Ok(())
}

async fn download_file(
    client: &reqwest::Client,
    dir: &Path,
    name: &str,
    remote: &str,
    expected: u64,
    sha: &str,
    on_progress: &impl Fn(VoiceProgress),
) -> AppResult<()> {
    let part = dir.join(format!("{name}.part"));
    let done = match fetch_into(client, &part, name, remote, expected, on_progress).await {
        Ok(done) => done,
        Err(error) => {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(error);
        }
    };
    if done != expected {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(AppError::Network(format!(
            "voice model {name}: expected {expected} bytes, got {done}"
        )));
    }
    let actual = match sha256_file(&part).await {
        Ok(actual) => actual,
        Err(error) => {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(error);
        }
    };
    if !actual.eq_ignore_ascii_case(sha) {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(AppError::Network(format!(
            "voice model {name}: checksum mismatch"
        )));
    }
    tokio::fs::rename(&part, dir.join(name))
        .await
        .map_err(|e| AppError::Internal(format!("voice model {name}: {e}")))?;
    on_progress(VoiceProgress {
        file: name.to_string(),
        done,
        total: done,
    });
    Ok(())
}

async fn fetch_into(
    client: &reqwest::Client,
    part: &Path,
    name: &str,
    remote: &str,
    expected: u64,
    on_progress: &impl Fn(VoiceProgress),
) -> AppResult<u64> {
    let url = format!("{HF_BASE}/{remote}");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("voice model {name}: {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "voice model {name}: HTTP {}",
            response.status()
        )));
    }
    let total = response.content_length().unwrap_or(expected);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(part)
        .await
        .map_err(|e| AppError::Internal(format!("voice model {name}: {e}")))?;
    let mut done = 0u64;
    let mut reported = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Network(format!("voice model {name}: {e}")))?;
        done += chunk.len() as u64;
        if done > expected {
            return Err(AppError::Network(format!(
                "voice model {name}: response larger than expected"
            )));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| AppError::Internal(format!("voice model {name}: {e}")))?;
        if done - reported >= PROGRESS_STEP {
            reported = done;
            on_progress(VoiceProgress {
                file: name.to_string(),
                done,
                total,
            });
        }
    }
    file.flush()
        .await
        .map_err(|e| AppError::Internal(format!("voice model {name}: {e}")))?;
    Ok(done)
}

async fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| AppError::Internal(format!("voice model checksum: {e}")))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|e| AppError::Internal(format!("voice model checksum: {e}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn audio_transcribe(
    app: AppHandle,
    client: State<'_, reqwest::Client>,
    pcm: Vec<i16>,
    sample_rate: u32,
) -> AppResult<Transcript> {
    if pcm.is_empty() {
        return Err(AppError::Internal("no audio captured".to_string()));
    }
    if !(8_000..=192_000).contains(&sample_rate) {
        return Err(AppError::Internal("unsupported sample rate".to_string()));
    }
    let max_samples = sample_rate as usize * MAX_SECONDS;
    if pcm.len() > max_samples {
        return Err(AppError::Internal("recording is too long".to_string()));
    }
    let seconds = pcm.len() as f32 / sample_rate as f32;
    if seconds < MIN_SECONDS {
        return Err(AppError::Internal("recording too short".to_string()));
    }
    let cfg = config(&app);
    if !cfg.enabled {
        return Err(AppError::Internal(
            "voice is off; enable it in Settings > Voice".to_string(),
        ));
    }
    let started = Instant::now();
    if let Some(provider) = cfg.provider.clone() {
        let model = cfg.model.clone().unwrap_or_else(|| "whisper-1".to_string());
        let text =
            remote_transcribe(client.inner(), &app, &provider, &model, &pcm, sample_rate).await?;
        return Ok(Transcript {
            text,
            ms: started.elapsed().as_millis() as u64,
        });
    }
    let mut samples = pcm_to_16k(&pcm, sample_rate);
    samples.truncate(SAMPLE_RATE as usize * MAX_SECONDS);
    let dir = model_dir(&app);
    if !model_ready(&dir) {
        return Err(AppError::Internal(
            "voice model is missing; download it in Settings > Voice".to_string(),
        ));
    }
    let text = tauri::async_runtime::spawn_blocking(move || local_transcribe(&dir, &samples))
        .await
        .map_err(|e| AppError::Internal(format!("voice worker: {e}")))??;
    schedule_idle_unload();
    Ok(Transcript {
        text,
        ms: started.elapsed().as_millis() as u64,
    })
}

fn unload_model() {
    let Some(slot) = MODEL.get() else {
        return;
    };
    let mut guard = slot.lock().unwrap_or_else(|error| error.into_inner());
    *guard = None;
}

fn unload_if_idle() {
    let Some(slot) = MODEL.get() else {
        return;
    };
    let mut guard = slot.lock().unwrap_or_else(|error| error.into_inner());
    let idle = guard
        .as_ref()
        .map(|loaded| loaded.used.elapsed() >= IDLE_UNLOAD)
        .unwrap_or(false);
    if idle {
        *guard = None;
    }
}

fn schedule_idle_unload() {
    let generation = UNLOAD_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_UNLOAD).await;
        if UNLOAD_GEN.load(Ordering::SeqCst) == generation {
            unload_if_idle();
        }
    });
}

fn local_transcribe(dir: &Path, samples: &[f32]) -> AppResult<String> {
    let mut slot = MODEL
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let stale = slot
        .as_ref()
        .map(|loaded| loaded.used.elapsed() > IDLE_UNLOAD)
        .unwrap_or(false);
    if stale {
        *slot = None;
    }
    if slot.is_none() {
        let model = MoonshineModel::load(dir, MoonshineVariant::Base, &Quantization::Int8)
            .map_err(|e| AppError::Internal(format!("voice model load: {e}")))?;
        *slot = Some(Loaded {
            model,
            used: Instant::now(),
        });
    }
    let loaded = slot
        .as_mut()
        .ok_or_else(|| AppError::Internal("voice model missing".to_string()))?;
    loaded.used = Instant::now();
    let result = loaded
        .model
        .transcribe_with(samples, &MoonshineParams::default())
        .map_err(|e| AppError::Internal(format!("voice transcription: {e}")))?;
    Ok(result.text.trim().to_string())
}

fn endpoint_url(base_url: &str) -> AppResult<String> {
    let parsed = reqwest::Url::parse(base_url.trim())
        .map_err(|e| AppError::Internal(format!("invalid connection URL: {e}")))?;
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err(AppError::Internal(
            "transcription needs an https endpoint (http is allowed only for localhost)"
                .to_string(),
        ));
    }
    Ok(format!(
        "{}/audio/transcriptions",
        base_url.trim_end_matches('/')
    ))
}

async fn remote_transcribe(
    client: &reqwest::Client,
    app: &AppHandle,
    provider: &str,
    model: &str,
    pcm: &[i16],
    sample_rate: u32,
) -> AppResult<String> {
    let base_url = connections::base_url_for(app, provider).await?;
    let key = vault::get_api_key(provider)?;
    let url = endpoint_url(&base_url)?;
    let part = reqwest::multipart::Part::bytes(wav_bytes(pcm, sample_rate))
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model.to_string());
    let response = client
        .post(url)
        .bearer_auth(key)
        .multipart(form)
        .timeout(Duration::from_secs(120))
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        return Err(AppError::Upstream(format!(
            "transcription HTTP {status}: {snippet}"
        )));
    }
    let bytes = response.bytes().await?;
    if bytes.len() > MAX_REMOTE_BYTES {
        return Err(AppError::Upstream(
            "transcription response is too large".to_string(),
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Upstream(format!("transcription response: {e}")))?;
    let text = value["text"].as_str().unwrap_or("").trim().to_string();
    if text.is_empty() {
        return Err(AppError::Upstream("empty transcription".to_string()));
    }
    Ok(text)
}

fn pcm_to_16k(pcm: &[i16], sample_rate: u32) -> Vec<f32> {
    let source: Vec<f32> = pcm.iter().map(|s| *s as f32 / 32_768.0).collect();
    if sample_rate == SAMPLE_RATE || source.is_empty() {
        return source;
    }
    let ratio = SAMPLE_RATE as f32 / sample_rate as f32;
    let out_len = (source.len() as f32 * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for index in 0..out_len {
        let position = index as f32 / ratio;
        let low = position.floor() as usize;
        let fraction = position - low as f32;
        let a = source[low.min(source.len() - 1)];
        let b = source[(low + 1).min(source.len() - 1)];
        out.push(a + (b - a) * fraction);
    }
    out
}

fn wav_bytes(pcm: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in pcm {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_scales_to_unit_range() {
        let samples = pcm_to_16k(&[0, 16_384, -32_768], SAMPLE_RATE);
        assert_eq!(samples.len(), 3);
        assert!((samples[0]).abs() < f32::EPSILON);
        assert!((samples[1] - 0.5).abs() < 0.001);
        assert!((samples[2] + 1.0).abs() < 0.001);
    }

    #[test]
    fn pcm_resamples_32k_to_16k() {
        let input = vec![0i16; 32_000];
        assert_eq!(pcm_to_16k(&input, 32_000).len(), 16_000);
    }

    #[test]
    fn pcm_resamples_48k_to_16k() {
        let input = vec![1_000i16; 48_000];
        assert_eq!(pcm_to_16k(&input, 48_000).len(), 16_000);
    }

    #[test]
    fn wav_header_matches_the_payload() {
        let bytes = wav_bytes(&[1, -1, 32_767], 16_000);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(bytes.len(), 44 + 6);
        let data_len = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert_eq!(data_len, 6);
    }

    #[test]
    fn wav_encodes_samples_little_endian() {
        let bytes = wav_bytes(&[0x0102], 16_000);
        assert_eq!(&bytes[44..46], &[0x02, 0x01]);
    }

    #[test]
    fn endpoint_requires_https_or_loopback() {
        assert!(endpoint_url("https://api.example.com/v1").is_ok());
        assert!(endpoint_url("http://localhost:11434/v1").is_ok());
        assert!(endpoint_url("http://127.0.0.1:8080/v1").is_ok());
        assert!(endpoint_url("http://api.example.com/v1").is_err());
        assert!(endpoint_url("ftp://api.example.com").is_err());
    }

    #[test]
    fn model_is_not_ready_without_files() {
        let dir = std::env::temp_dir().join("myagent-voice-missing");
        assert!(!model_ready(&dir));
    }

    #[tokio::test]
    #[ignore = "downloads the Moonshine model and needs MYAGENT_VOICE_WAV"]
    async fn transcribes_a_wav_fixture() {
        let dir = std::env::var("MYAGENT_VOICE_MODEL_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("myagent-voice-model"));
        let wav = std::env::var("MYAGENT_VOICE_WAV").expect("MYAGENT_VOICE_WAV");
        let client = reqwest::Client::new();
        download_model(&client, &dir, |_| {})
            .await
            .expect("download");
        let samples = transcribe_rs::audio::read_wav_samples(Path::new(&wav)).expect("read wav");
        let text = local_transcribe(&dir, &samples).expect("transcribe");
        eprintln!("voice transcript: {text}");
        assert!(!text.trim().is_empty());
    }
}
