use crate::*;
use bzip2::read::BzDecoder;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use tar::Archive;

const PARAKEET_MODEL_ID: &str = "parakeet-tdt-0.6b-v3-int8";
const PARAKEET_ARCHIVE_ROOT: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const PARAKEET_MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2";
const PARAKEET_MODEL_ARCHIVE_SHA256: &str =
    "5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf";
const PARAKEET_INSTALL_DIR_NAME: &str = "parakeet-model";
const WHISPER_MODEL_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const WHISPER_INSTALL_DIR_NAME: &str = "whisper-models";
const SHERPA_RELEASE_VERSION: &str = "v1.13.2";
const SHERPA_INSTALL_DIR_NAME: &str = "sherpa-onnx";
#[cfg(windows)]
const SHERPA_BINARY_NAME: &str = "sherpa-onnx-offline.exe";
#[cfg(not(windows))]
const SHERPA_BINARY_NAME: &str = "sherpa-onnx-offline";
const PARAKEET_REQUIRED_FILES: [&str; 4] = [
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
];
const PARAKEET_PROGRESS_EVENT: &str = "parakeet-model-download-progress";
const WHISPER_PROGRESS_EVENT: &str = "whisper-model-download-progress";
const DOWNLOAD_PROGRESS_CHUNK_BYTES: u64 = 1024 * 1024;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadProgress<'a> {
    stage: &'a str,
    loaded: u64,
    total: Option<u64>,
    percent: Option<f64>,
}

fn parakeet_model_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(PARAKEET_INSTALL_DIR_NAME)
}

fn whisper_model_file_name(model: &str) -> Option<&'static str> {
    match model {
        "whisper-tiny" => Some("ggml-tiny.bin"),
        "whisper-tiny.en" => Some("ggml-tiny.en.bin"),
        "whisper-base" => Some("ggml-base.bin"),
        "whisper-base.en" => Some("ggml-base.en.bin"),
        "whisper-large-v3-turbo" => Some("ggml-large-v3-turbo.bin"),
        _ => None,
    }
}

fn whisper_model_sha256(model: &str) -> Option<&'static str> {
    match model {
        "whisper-tiny" => Some("be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"),
        "whisper-tiny.en" => {
            Some("921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f")
        }
        "whisper-base" => Some("60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"),
        "whisper-base.en" => {
            Some("a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002")
        }
        "whisper-large-v3-turbo" => {
            Some("1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69")
        }
        _ => None,
    }
}

fn parakeet_model_archive_sha256(model: &str) -> Option<&'static str> {
    match model {
        PARAKEET_MODEL_ID => Some(PARAKEET_MODEL_ARCHIVE_SHA256),
        _ => None,
    }
}

fn whisper_model_path(data_dir: &Path, model: &str) -> Option<PathBuf> {
    whisper_model_file_name(model)
        .map(|file_name| data_dir.join(WHISPER_INSTALL_DIR_NAME).join(file_name))
}

fn parakeet_model_ready(model_dir: &Path) -> bool {
    model_dir.is_dir()
        && PARAKEET_REQUIRED_FILES
            .iter()
            .all(|file_name| model_dir.join(file_name).is_file())
}

fn sherpa_sidecar_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(SHERPA_INSTALL_DIR_NAME)
}

fn sherpa_sidecar_archive_name() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Ok("sherpa-onnx-v1.13.2-linux-x64-static-no-tts.tar.bz2"),
        ("linux", "aarch64") => Ok("sherpa-onnx-v1.13.2-linux-aarch64-static.tar.bz2"),
        ("macos", "x86_64") => Ok("sherpa-onnx-v1.13.2-osx-x64-static-no-tts.tar.bz2"),
        ("macos", "aarch64") => Ok("sherpa-onnx-v1.13.2-osx-arm64-static-no-tts.tar.bz2"),
        ("windows", "x86_64") => Ok("sherpa-onnx-v1.13.2-win-x64-static-MT-Release-no-tts.tar.bz2"),
        ("windows", "aarch64") => {
            Ok("sherpa-onnx-v1.13.2-win-arm64-static-MT-Release-no-tts.tar.bz2")
        }
        (os, arch) => Err(format!(
            "Parakeet runtime download is not available for {os}/{arch}"
        )),
    }
}

fn sherpa_sidecar_archive_sha256(archive_name: &str) -> Option<&'static str> {
    match archive_name {
        "sherpa-onnx-v1.13.2-linux-x64-static-no-tts.tar.bz2" => {
            Some("3aef3e284030568abe0640d6e12e00b8015077a1ed94d29e3b60374d060d1daf")
        }
        "sherpa-onnx-v1.13.2-linux-aarch64-static.tar.bz2" => {
            Some("f07daeaf592e09ed8a98121c195a2ff90a48405135c209a3906d9d7f93abc7da")
        }
        "sherpa-onnx-v1.13.2-osx-x64-static-no-tts.tar.bz2" => {
            Some("1cf9a3061e9393e511f5a0a44f44aa0426c94673f60dff7ddf3e69ea668ee80f")
        }
        "sherpa-onnx-v1.13.2-osx-arm64-static-no-tts.tar.bz2" => {
            Some("037fa6d0619334502e16f47e12e642d5be43d1189df61188931e0ea2c728f5cd")
        }
        "sherpa-onnx-v1.13.2-win-x64-static-MT-Release-no-tts.tar.bz2" => {
            Some("15d10ec7af9a8ddce310babc293307aefdd25204a78a0f15684ecebfa72df132")
        }
        "sherpa-onnx-v1.13.2-win-arm64-static-MT-Release-no-tts.tar.bz2" => {
            Some("e8abbc101440b48f6c8e322eb3dab10df578774a039ff54ef9d0989c7e72bc00")
        }
        _ => None,
    }
}

fn verify_file_sha256(path: &Path, label: &str, expected_sha256: &str) -> Result<(), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let bytes_read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected_sha256) {
        Ok(())
    } else {
        Err(format!(
            "{label} SHA-256 mismatch: expected {expected_sha256}, got {actual}"
        ))
    }
}

fn find_file_recursive(root: &Path, file_name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name == file_name)
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, file_name) {
                return Some(found);
            }
        }
    }
    None
}

fn managed_sherpa_binary(data_dir: &Path) -> Option<PathBuf> {
    find_file_recursive(&sherpa_sidecar_dir(data_dir), SHERPA_BINARY_NAME)
}

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(path, permissions).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn emit_download_progress(
    app: &tauri::AppHandle,
    event_name: &'static str,
    stage: &'static str,
    loaded: u64,
    total: Option<u64>,
) {
    let percent = total.and_then(|value| {
        if value == 0 {
            None
        } else {
            Some(((loaded as f64 / value as f64) * 100.0).clamp(0.0, 100.0))
        }
    });
    let payload = ModelDownloadProgress {
        stage,
        loaded,
        total,
        percent,
    };
    let _ = tauri::Emitter::emit(app, event_name, payload);
}

fn validate_download_size(label: &str, total: Option<u64>, loaded: u64) -> Result<(), String> {
    if let Some(expected) = total {
        if loaded != expected {
            return Err(format!(
                "{label} download incomplete: expected {expected} bytes, got {loaded}"
            ));
        }
    }
    Ok(())
}

fn download_to_file(
    app: &tauri::AppHandle,
    event_name: &'static str,
    stage: &'static str,
    url: &str,
    destination: &Path,
    label: &str,
) -> Result<(), String> {
    let mut response = reqwest::blocking::get(url)
        .map_err(|error| format!("Failed to download {label}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{label} download failed ({})", response.status()));
    }

    let total = response.content_length();
    emit_download_progress(app, event_name, stage, 0, total);

    let mut file = File::create(destination).map_err(|error| error.to_string())?;
    let mut buffer = [0u8; 64 * 1024];
    let mut loaded = 0u64;
    let mut last_emitted = 0u64;
    loop {
        let bytes_read = response
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }
        file.write_all(&buffer[..bytes_read])
            .map_err(|error| error.to_string())?;
        loaded = loaded.saturating_add(bytes_read as u64);
        if loaded.saturating_sub(last_emitted) >= DOWNLOAD_PROGRESS_CHUNK_BYTES {
            emit_download_progress(app, event_name, stage, loaded, total);
            last_emitted = loaded;
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    validate_download_size(label, total, loaded)?;
    emit_download_progress(app, event_name, stage, loaded, total);
    Ok(())
}

fn ensure_sherpa_sidecar(data_dir: &Path, app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(binary) = managed_sherpa_binary(data_dir) {
        ensure_executable(&binary)?;
        return Ok(binary);
    }

    let archive_name = sherpa_sidecar_archive_name()?;
    let url = format!(
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/{SHERPA_RELEASE_VERSION}/{archive_name}"
    );
    let temp_dir = tempfile::Builder::new()
        .prefix("sherpa-onnx-")
        .tempdir_in(data_dir)
        .map_err(|error| error.to_string())?;
    let archive_path = temp_dir.path().join(archive_name);
    let extract_dir = temp_dir.path().join("extract");
    fs::create_dir_all(&extract_dir).map_err(|error| error.to_string())?;

    download_to_file(
        app,
        PARAKEET_PROGRESS_EVENT,
        "runtime_download",
        &url,
        &archive_path,
        "sherpa-onnx runtime",
    )?;
    let expected_sha256 = sherpa_sidecar_archive_sha256(archive_name).ok_or_else(|| {
        format!("No pinned SHA-256 digest for sherpa-onnx runtime archive {archive_name}")
    })?;
    verify_file_sha256(&archive_path, "sherpa-onnx runtime", expected_sha256)?;
    unpack_tar_bz2(&archive_path, &extract_dir)?;
    let binary = find_file_recursive(&extract_dir, SHERPA_BINARY_NAME).ok_or_else(|| {
        "Downloaded sherpa-onnx runtime is missing sherpa-onnx-offline".to_string()
    })?;
    ensure_executable(&binary)?;

    let install_dir = sherpa_sidecar_dir(data_dir);
    if install_dir.exists() {
        if install_dir.is_dir() {
            fs::remove_dir_all(&install_dir).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&install_dir).map_err(|error| error.to_string())?;
        }
    }
    fs::rename(&extract_dir, &install_dir).map_err(|error| error.to_string())?;
    let installed_binary = managed_sherpa_binary(data_dir).ok_or_else(|| {
        "Installed sherpa-onnx runtime is missing sherpa-onnx-offline".to_string()
    })?;
    ensure_executable(&installed_binary)?;
    Ok(installed_binary)
}

fn unpack_tar_bz2(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|error| error.to_string())?;
    let decoder = BzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    let entries = archive.entries().map_err(|error| error.to_string())?;
    for entry in entries {
        let mut entry = entry.map_err(|error| error.to_string())?;
        entry
            .unpack_in(destination)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn start_audio_recording(
    state: tauri::State<'_, AudioRecorderState>,
) -> Result<(), String> {
    let mut guard = state
        .inner()
        .0
        .lock()
        .map_err(|_| "Recorder lock poisoned".to_string())?;
    if guard.is_some() {
        return Err("Recording already in progress".into());
    }

    let samples: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
    let info: Arc<Mutex<Option<RecorderInfo>>> = Arc::new(Mutex::new(None));
    let (stop_tx, stop_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();

    let samples_clone = samples.clone();
    let info_clone = info.clone();
    let join = std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device().or_else(|| {
            host.input_devices()
                .ok()
                .and_then(|mut devices| devices.next())
        }) {
            Some(device) => device,
            None => {
                let _ = ready_tx.send(Err("No audio input device available".to_string()));
                return;
            }
        };
        let config = match device.default_input_config() {
            Ok(cfg) => cfg,
            Err(err) => {
                let _ = ready_tx.send(Err(format!("Failed to read input config: {err}")));
                return;
            }
        };
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();

        let err_fn = |err| {
            eprintln!("[audio] stream error: {err}");
        };

        let stream_config: cpal::StreamConfig = config.clone().into();
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    let Ok(mut buffer) = samples_clone.lock() else {
                        return;
                    };
                    buffer.extend(data.iter().map(|sample| {
                        let clamped = sample.clamp(-1.0, 1.0);
                        (clamped * i16::MAX as f32) as i16
                    }));
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let Ok(mut buffer) = samples_clone.lock() else {
                        return;
                    };
                    buffer.extend_from_slice(data);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    let Ok(mut buffer) = samples_clone.lock() else {
                        return;
                    };
                    buffer.extend(data.iter().map(|sample| (*sample as i32 - 32768) as i16));
                },
                err_fn,
                None,
            ),
            _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
        };

        let stream = match stream {
            Ok(stream) => stream,
            Err(err) => {
                let _ = ready_tx.send(Err(format!("Failed to create audio stream: {err}")));
                return;
            }
        };

        if let Err(err) = stream.play() {
            let _ = ready_tx.send(Err(format!("Failed to start audio stream: {err}")));
            return;
        }

        if let Ok(mut info_guard) = info_clone.lock() {
            *info_guard = Some(RecorderInfo {
                sample_rate,
                channels,
            });
        }

        let _ = ready_tx.send(Ok(()));

        let _ = stop_rx.recv();
        drop(stream);
    });

    match ready_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(())) => {
            *guard = Some(AudioRecorderHandle {
                stop_tx,
                samples,
                info,
                join: Some(join),
            });
            Ok(())
        }
        Ok(Err(err)) => Err(err),
        Err(_) => Err("Audio device did not respond".into()),
    }
}

#[tauri::command]
pub(crate) fn stop_audio_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioRecorderState>,
) -> Result<AudioCaptureResult, String> {
    let mut guard = state
        .inner()
        .0
        .lock()
        .map_err(|_| "Recorder lock poisoned".to_string())?;
    let mut recorder = guard
        .take()
        .ok_or_else(|| "No active recording".to_string())?;

    let _ = recorder.stop_tx.send(());
    if let Some(join) = recorder.join.take() {
        let _ = join.join();
    }

    let info = recorder
        .info
        .lock()
        .map_err(|_| "Recorder info lock poisoned".to_string())?;
    let info = info
        .clone()
        .ok_or_else(|| "Recorder did not initialize".to_string())?;
    let samples = recorder
        .samples
        .lock()
        .map_err(|_| "Recorder buffer lock poisoned".to_string())?;
    if samples.is_empty() {
        return Err("No audio captured".into());
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let file_name = format!("mindwtr-audio-{timestamp}.wav");
    let relative_path = format!("{}/audio-captures/{}", APP_NAME, file_name);

    let target_dir = get_data_dir(&app).join("audio-captures");
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target_path = target_dir.join(&file_name);

    let spec = hound::WavSpec {
        channels: info.channels,
        sample_rate: info.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&target_path, spec).map_err(|e| e.to_string())?;
    for sample in samples.iter() {
        writer.write_sample(*sample).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;

    Ok(AudioCaptureResult {
        path: target_path.to_string_lossy().to_string(),
        relative_path,
        sample_rate: info.sample_rate,
        channels: info.channels,
        size: samples.len() * std::mem::size_of::<i16>(),
    })
}

#[tauri::command]
pub(crate) fn transcribe_whisper(
    model_path: String,
    audio_path: String,
    language: Option<String>,
) -> Result<String, String> {
    let model_exists = Path::new(&model_path).exists();
    if !model_exists {
        return Err("Whisper model not found".into());
    }

    let mut reader = hound::WavReader::open(&audio_path).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    if spec.channels == 0 || spec.channels > 2 {
        return Err("Unsupported audio channel count".into());
    }

    let mut samples = Vec::new();
    for sample in reader.samples::<i16>() {
        let value = sample.map_err(|e| e.to_string())?;
        samples.push(value);
    }

    let mut audio = vec![0.0f32; samples.len()];
    whisper_rs::convert_integer_to_float_audio(&samples, &mut audio).map_err(|e| e.to_string())?;
    if spec.channels == 2 {
        let mut mono_audio = vec![0.0f32; audio.len() / 2];
        whisper_rs::convert_stereo_to_mono_audio(&audio, &mut mono_audio)
            .map_err(|e| e.to_string())?;
        audio = mono_audio;
    }
    if spec.sample_rate != 16_000 {
        audio = resample_linear(&audio, spec.sample_rate, 16_000);
    }

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    if let Ok(threads) = std::thread::available_parallelism() {
        params.set_n_threads(threads.get() as i32);
    }

    let language_hint = language.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    if let Some(ref lang) = language_hint {
        params.set_language(Some(lang));
    }

    let ctx = WhisperContext::new_with_params(&model_path, WhisperContextParameters::default())
        .map_err(|e| e.to_string())?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    state.full(params, &audio[..]).map_err(|e| e.to_string())?;

    let num_segments = state.full_n_segments();
    let mut text = String::new();
    if num_segments > 0 {
        for i in 0..num_segments {
            if let Some(segment) = state.get_segment(i) {
                if let Ok(seg_text) = segment.to_str_lossy() {
                    text.push_str(&seg_text);
                }
            }
        }
    }

    Ok(text.trim().to_string())
}

#[tauri::command]
pub(crate) async fn download_parakeet_model(
    app: tauri::AppHandle,
    model: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_parakeet_model_blocking(app, model))
        .await
        .map_err(|error| format!("Parakeet download task failed: {error}"))?
}

fn download_parakeet_model_blocking(
    app: tauri::AppHandle,
    model: String,
) -> Result<String, String> {
    if model != PARAKEET_MODEL_ID {
        return Err("Unsupported Parakeet model".into());
    }

    let data_dir = get_data_dir(&app);
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let target_dir = parakeet_model_dir(&data_dir);
    ensure_sherpa_sidecar(&data_dir, &app)?;
    if parakeet_model_ready(&target_dir) {
        return Ok(target_dir.to_string_lossy().to_string());
    }

    let temp_dir = tempfile::Builder::new()
        .prefix("parakeet-model-")
        .tempdir_in(&data_dir)
        .map_err(|error| error.to_string())?;
    let archive_path = temp_dir.path().join("model.tar.bz2");
    let extract_dir = temp_dir.path().join("extract");
    fs::create_dir_all(&extract_dir).map_err(|error| error.to_string())?;

    download_to_file(
        &app,
        PARAKEET_PROGRESS_EVENT,
        "model_download",
        PARAKEET_MODEL_URL,
        &archive_path,
        "Parakeet model",
    )?;
    let expected_sha256 = parakeet_model_archive_sha256(&model)
        .ok_or_else(|| format!("No pinned SHA-256 digest for Parakeet model {model}"))?;
    verify_file_sha256(&archive_path, "Parakeet model", expected_sha256)?;

    emit_download_progress(&app, PARAKEET_PROGRESS_EVENT, "install", 0, None);
    unpack_tar_bz2(&archive_path, &extract_dir)?;
    let extracted_model_dir = extract_dir.join(PARAKEET_ARCHIVE_ROOT);
    if !parakeet_model_ready(&extracted_model_dir) {
        return Err("Downloaded Parakeet archive is missing required model files".into());
    }

    if target_dir.exists() {
        if target_dir.is_dir() {
            fs::remove_dir_all(&target_dir).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&target_dir).map_err(|error| error.to_string())?;
        }
    }
    fs::rename(&extracted_model_dir, &target_dir).map_err(|error| error.to_string())?;
    emit_download_progress(&app, PARAKEET_PROGRESS_EVENT, "install", 100, Some(100));

    Ok(target_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) async fn download_whisper_model(
    app: tauri::AppHandle,
    model: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_whisper_model_blocking(app, model))
        .await
        .map_err(|error| format!("Whisper download task failed: {error}"))?
}

fn download_whisper_model_blocking(app: tauri::AppHandle, model: String) -> Result<String, String> {
    let file_name =
        whisper_model_file_name(&model).ok_or_else(|| "Unsupported Whisper model".to_string())?;
    let expected_sha256 =
        whisper_model_sha256(&model).ok_or_else(|| "Unsupported Whisper model".to_string())?;
    let data_dir = get_data_dir(&app);
    let target_path = whisper_model_path(&data_dir, &model)
        .ok_or_else(|| "Unsupported Whisper model".to_string())?;
    if target_path.is_file() {
        if verify_file_sha256(&target_path, "Whisper model", expected_sha256).is_ok() {
            return Ok(target_path.to_string_lossy().to_string());
        }
        fs::remove_file(&target_path).map_err(|error| error.to_string())?;
    }

    let target_dir = data_dir.join(WHISPER_INSTALL_DIR_NAME);
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let temp_dir = tempfile::Builder::new()
        .prefix("whisper-model-")
        .tempdir_in(&data_dir)
        .map_err(|error| error.to_string())?;
    let temp_path = temp_dir.path().join(file_name);
    let url = format!("{WHISPER_MODEL_BASE_URL}/{file_name}");

    download_to_file(
        &app,
        WHISPER_PROGRESS_EVENT,
        "model_download",
        &url,
        &temp_path,
        "Whisper model",
    )?;
    verify_file_sha256(&temp_path, "Whisper model", expected_sha256)?;

    fs::rename(&temp_path, &target_path).map_err(|error| error.to_string())?;
    Ok(target_path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn transcribe_parakeet(
    model_path: String,
    audio_path: String,
    language: Option<String>,
) -> Result<String, String> {
    let model_dir = Path::new(&model_path);
    if !model_dir.is_dir() {
        return Err("Parakeet model directory not found".into());
    }
    let audio_file = Path::new(&audio_path);
    if !audio_file.is_file() {
        return Err("Audio file not found".into());
    }

    let encoder = model_dir.join("encoder.int8.onnx");
    let decoder = model_dir.join("decoder.int8.onnx");
    let joiner = model_dir.join("joiner.int8.onnx");
    let tokens = model_dir.join("tokens.txt");
    for required in [&encoder, &decoder, &joiner, &tokens] {
        if !required.is_file() {
            return Err(format!(
                "Parakeet model file missing: {}",
                required
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("unknown")
            ));
        }
    }

    let managed_binary = model_dir.parent().and_then(managed_sherpa_binary);
    let mut command = Command::new(
        managed_binary
            .as_deref()
            .unwrap_or_else(|| Path::new(SHERPA_BINARY_NAME)),
    );
    if let Some(binary) = managed_binary.as_deref() {
        if let Some(parent) = binary.parent() {
            command.current_dir(parent);
        }
    }
    command
        .arg(format!("--encoder={}", encoder.to_string_lossy()))
        .arg(format!("--decoder={}", decoder.to_string_lossy()))
        .arg(format!("--joiner={}", joiner.to_string_lossy()))
        .arg(format!("--tokens={}", tokens.to_string_lossy()))
        .arg("--model-type=nemo_transducer")
        .arg(audio_file);

    let language_hint = language.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    if let Some(lang) = language_hint {
        command.arg("--decoding-method").arg("greedy_search");
        log::debug!("Parakeet language hint ignored by sherpa-onnx sidecar: {lang}");
    }

    let output = command
        .output()
        .map_err(|error| format!("Failed to run sherpa-onnx-offline: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("sherpa-onnx-offline exited with status {}", output.status)
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(extract_sherpa_transcript(&stdout))
}

fn extract_sherpa_transcript(output: &str) -> String {
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| {
            !line.is_empty() && !line.starts_with("Started!") && !line.starts_with("Done!")
        })
        .unwrap_or("")
        .trim_matches('"')
        .trim()
        .to_string()
}

fn resample_linear(input: &[f32], input_rate: u32, target_rate: u32) -> Vec<f32> {
    if input_rate == target_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = input_rate as f64 / target_rate as f64;
    let output_len = ((input.len() as f64) / ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);
    for i in 0..output_len {
        let position = i as f64 * ratio;
        let index = position.floor() as usize;
        let next_index = (index + 1).min(input.len() - 1);
        let frac = position - index as f64;
        let sample = input[index] * (1.0 - frac as f32) + input[next_index] * (frac as f32);
        output.push(sample);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parakeet_model_dir_uses_app_data_install_folder() {
        let data_dir = Path::new("/home/dd/.local/share/mindwtr");

        assert_eq!(
            parakeet_model_dir(data_dir),
            PathBuf::from("/home/dd/.local/share/mindwtr/parakeet-model")
        );
    }

    #[test]
    fn parakeet_model_ready_requires_all_model_files() {
        let temp_dir = tempfile::tempdir().expect("should create temp dir");
        let model_dir = temp_dir.path().join("parakeet-model");
        fs::create_dir_all(&model_dir).expect("should create model dir");

        assert!(!parakeet_model_ready(&model_dir));

        for file_name in PARAKEET_REQUIRED_FILES {
            File::create(model_dir.join(file_name)).expect("should create required model file");
        }

        assert!(parakeet_model_ready(&model_dir));
    }

    #[test]
    fn managed_sherpa_binary_finds_installed_sidecar_recursively() {
        let temp_dir = tempfile::tempdir().expect("should create temp dir");
        let binary_dir = temp_dir
            .path()
            .join("sherpa-onnx")
            .join("sherpa-onnx-v1.13.2-linux-x64-static-no-tts")
            .join("bin");
        fs::create_dir_all(&binary_dir).expect("should create binary dir");
        let binary = binary_dir.join(SHERPA_BINARY_NAME);
        File::create(&binary).expect("should create sidecar binary");

        assert_eq!(managed_sherpa_binary(temp_dir.path()), Some(binary));
    }

    #[test]
    fn supported_sherpa_sidecar_archives_have_pinned_hashes() {
        let archives = [
            (
                "sherpa-onnx-v1.13.2-linux-x64-static-no-tts.tar.bz2",
                "3aef3e284030568abe0640d6e12e00b8015077a1ed94d29e3b60374d060d1daf",
            ),
            (
                "sherpa-onnx-v1.13.2-linux-aarch64-static.tar.bz2",
                "f07daeaf592e09ed8a98121c195a2ff90a48405135c209a3906d9d7f93abc7da",
            ),
            (
                "sherpa-onnx-v1.13.2-osx-x64-static-no-tts.tar.bz2",
                "1cf9a3061e9393e511f5a0a44f44aa0426c94673f60dff7ddf3e69ea668ee80f",
            ),
            (
                "sherpa-onnx-v1.13.2-osx-arm64-static-no-tts.tar.bz2",
                "037fa6d0619334502e16f47e12e642d5be43d1189df61188931e0ea2c728f5cd",
            ),
            (
                "sherpa-onnx-v1.13.2-win-x64-static-MT-Release-no-tts.tar.bz2",
                "15d10ec7af9a8ddce310babc293307aefdd25204a78a0f15684ecebfa72df132",
            ),
            (
                "sherpa-onnx-v1.13.2-win-arm64-static-MT-Release-no-tts.tar.bz2",
                "e8abbc101440b48f6c8e322eb3dab10df578774a039ff54ef9d0989c7e72bc00",
            ),
        ];

        for (archive, expected_digest) in archives {
            let digest = sherpa_sidecar_archive_sha256(archive)
                .unwrap_or_else(|| panic!("missing digest for {archive}"));

            assert_eq!(digest, expected_digest);
        }
    }

    #[test]
    fn verify_file_sha256_rejects_mismatched_content() {
        let temp_dir = tempfile::tempdir().expect("should create temp dir");
        let file_path = temp_dir.path().join("archive.tar.bz2");
        fs::write(&file_path, b"tampered archive").expect("should write archive");

        let error = verify_file_sha256(
            &file_path,
            "sherpa-onnx runtime",
            "0000000000000000000000000000000000000000000000000000000000000000",
        )
        .expect_err("hash mismatch should fail");

        assert!(error.contains("sherpa-onnx runtime SHA-256 mismatch"));
        assert!(error
            .contains("expected 0000000000000000000000000000000000000000000000000000000000000000"));
    }

    #[test]
    fn validate_download_size_rejects_truncated_content_length() {
        let error = validate_download_size("Whisper model", Some(10), 9)
            .expect_err("short download should fail");

        assert!(error.contains("Whisper model download incomplete"));
        assert!(error.contains("expected 10 bytes, got 9"));
        assert!(validate_download_size("Whisper model", Some(10), 10).is_ok());
        assert!(validate_download_size("Whisper model", None, 9).is_ok());
    }

    #[test]
    fn whisper_model_hashes_are_pinned() {
        let models = [
            (
                "whisper-tiny",
                "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
            ),
            (
                "whisper-tiny.en",
                "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
            ),
            (
                "whisper-base",
                "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
            ),
            (
                "whisper-base.en",
                "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
            ),
            (
                "whisper-large-v3-turbo",
                "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
            ),
        ];

        for (model, expected_digest) in models {
            assert_eq!(whisper_model_sha256(model), Some(expected_digest));
        }
    }

    #[test]
    fn parakeet_model_archive_hash_is_pinned() {
        assert_eq!(
            parakeet_model_archive_sha256(PARAKEET_MODEL_ID),
            Some("5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf")
        );
    }
}
