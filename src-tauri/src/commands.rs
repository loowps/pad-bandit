use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::audio::cache;
use crate::audio::peaks::{self, Peaks};
use crate::audio::play::{PlayRequest, PlaybackEvents, Player};
use crate::card::{CardPresence, CardState};
use crate::config::Config;
use crate::error::Result;
use crate::fs::Entry;
use crate::projects::{Journal, PROJECT_EXTENSION, Project, StoredProject};
use crate::state::{AppState, SyncResult};
use crate::sync::{Preflight, SyncPlan};
use crate::sync::apply::Progress;

#[tauri::command]
pub fn config_get(state: State<'_, AppState>) -> Config {
    state.config()
}

#[tauri::command]
pub fn config_add_folder(state: State<'_, AppState>, path: PathBuf) -> Result<Config> {
    state.add_browse_folder(&path)
}

#[tauri::command]
pub fn config_remove_folder(state: State<'_, AppState>, id: String) -> Result<Config> {
    state.remove_browse_folder(&id)
}

#[tauri::command]
pub fn config_set_card_path(state: State<'_, AppState>, path: Option<PathBuf>) -> Result<Config> {
    state.set_card_path(path.as_deref())
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Option<PathBuf> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog().file().pick_folder(move |picked| {
        let _ = sender.blocking_send(picked);
    });

    receiver
        .recv()
        .await
        .flatten()
        .and_then(|picked| picked.into_path().ok())
}

#[tauri::command]
pub fn list_dir(state: State<'_, AppState>, path: PathBuf) -> Result<Vec<Entry>> {
    state.with_scopes(|scopes| crate::fs::list_dir(scopes, &path))
}

#[tauri::command]
pub fn card_read(state: State<'_, AppState>) -> Result<CardState> {
    state.read_card()
}

#[tauri::command]
pub fn card_presence(state: State<'_, AppState>) -> CardPresence {
    state.card_presence()
}

#[tauri::command]
pub fn sync_preflight(state: State<'_, AppState>, plan: SyncPlan) -> Result<Preflight> {
    state.preflight(&plan)
}

#[tauri::command]
pub async fn project_pick_to_save(app: AppHandle, state: State<'_, AppState>) -> Result<Option<PathBuf>> {
    let picked = ask_for_project_file(&app, Purpose::Save).await;
    grant(&state, picked)
}

#[tauri::command]
pub async fn project_pick_to_open(app: AppHandle, state: State<'_, AppState>) -> Result<Option<PathBuf>> {
    let picked = ask_for_project_file(&app, Purpose::Open).await;
    grant(&state, picked)
}

#[tauri::command]
pub fn project_save(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
    project: Project,
) -> Result<StoredProject> {
    let stored = state.save_project(&path, &project)?;
    refresh_menu(&app, &state);
    Ok(stored)
}

#[tauri::command]
pub fn project_open(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
) -> Result<StoredProject> {
    let opened = state.open_project(&path)?;
    refresh_menu(&app, &state);
    Ok(opened)
}

#[tauri::command]
pub fn project_recent(state: State<'_, AppState>) -> Vec<PathBuf> {
    state.recent_projects()
}

#[tauri::command]
pub fn project_forget_recent(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<PathBuf>,
) -> Result<Config> {
    let config = match path {
        Some(path) => state.forget_recent_project(&path)?,
        None => state.forget_recent_projects()?,
    };
    refresh_menu(&app, &state);
    Ok(config)
}

#[tauri::command]
pub fn journal_write(state: State<'_, AppState>, journal: Journal) -> Result<()> {
    state.write_journal(&journal)
}

#[tauri::command]
pub fn journal_read(state: State<'_, AppState>) -> Option<Journal> {
    state.read_journal()
}

#[tauri::command]
pub fn journal_clear(state: State<'_, AppState>) -> Result<()> {
    state.clear_journal()
}

#[tauri::command]
pub fn window_set_title(window: tauri::Window, title: String) -> Result<()> {
    window
        .set_title(&title)
        .map_err(|error| crate::Error::Window(error.to_string()))
}

enum Purpose {
    Open,
    Save,
}

async fn ask_for_project_file(app: &AppHandle, purpose: Purpose) -> Option<PathBuf> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let dialog = app
        .dialog()
        .file()
        .add_filter("Pad Bandit project", &[PROJECT_EXTENSION]);

    match purpose {
        Purpose::Open => dialog.pick_file(move |picked| {
            let _ = sender.blocking_send(picked);
        }),
        Purpose::Save => dialog.save_file(move |picked| {
            let _ = sender.blocking_send(picked);
        }),
    }

    receiver
        .recv()
        .await
        .flatten()
        .and_then(|picked| picked.into_path().ok())
}

fn grant(state: &State<'_, AppState>, picked: Option<PathBuf>) -> Result<Option<PathBuf>> {
    picked
        .map(|path| state.grant_project_file(&with_project_extension(path)))
        .transpose()
}

fn with_project_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some_and(|it| it == PROJECT_EXTENSION) {
        path
    } else {
        let mut named = path.into_os_string();
        named.push(".");
        named.push(PROJECT_EXTENSION);
        PathBuf::from(named)
    }
}

fn refresh_menu(app: &AppHandle, state: &State<'_, AppState>) {
    if let Err(error) = crate::menu::apply(app, &state.recent_projects()) {
        eprintln!("the menu could not be rebuilt: {error}");
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExactPeaks {
    pub path: PathBuf,
    pub peaks: Peaks,
}

#[tauri::command]
pub fn audio_peaks(
    app: AppHandle,
    state: State<'_, AppState>,
    path: PathBuf,
    columns: usize,
) -> Result<Peaks> {
    let resolved = state.with_scopes(|scopes| scopes.readable(&path))?;
    let app_data = state.app_data();
    let key = cache::cache_key(&resolved)?;

    if let Some(chunks) = cache::load(&app_data, &key) {
        return Ok(peaks::reduce(&chunks, columns));
    }

    let sampled = peaks::sampled_peaks(&resolved, columns)?;
    if sampled.exact {
        return Ok(sampled);
    }

    tauri::async_runtime::spawn_blocking(move || match peaks::exact_chunks(&resolved) {
        Ok(chunks) => {
            if let Err(error) = cache::store(&app_data, &key, &chunks) {
                eprintln!("could not cache peaks for {}: {error}", resolved.display());
            }
            let _ = app.emit(
                "peaks:exact",
                ExactPeaks {
                    peaks: peaks::reduce(&chunks, columns),
                    path: resolved,
                },
            );
        }
        Err(error) => {
            eprintln!("exact peaks failed for {}: {error}", resolved.display());
        }
    });

    Ok(sampled)
}

pub struct PlaybackBridge {
    app: AppHandle,
}

impl PlaybackBridge {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl PlaybackEvents for PlaybackBridge {
    fn position(&self, frame: u64) {
        let _ = self.app.emit("audio:position", frame);
    }

    fn ended(&self) {
        let _ = self.app.emit("audio:ended", ());
    }

    fn error(&self, message: String) {
        let _ = self.app.emit("audio:error", message);
    }
}

#[tauri::command]
pub fn audio_play(
    state: State<'_, AppState>,
    player: State<'_, Player>,
    request: PlayRequest,
) -> Result<()> {
    let path = state.with_scopes(|scopes| scopes.readable(&request.path))?;
    player.play(&PlayRequest { path, ..request })
}

#[tauri::command]
pub fn audio_stop(player: State<'_, Player>) -> Result<()> {
    player.stop()
}

#[tauri::command]
pub fn audio_set_gain(player: State<'_, Player>, gain: f32) -> Result<()> {
    player.set_gain(gain)
}

#[tauri::command]
pub fn audio_seek(player: State<'_, Player>, frame: u64) -> Result<()> {
    player.seek(frame)
}

#[tauri::command]
pub async fn sync_apply(app: AppHandle, plan: SyncPlan) -> Result<SyncResult> {
    let emitter = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = emitter.state::<AppState>();
        let mut report = |progress: Progress| {
            let _ = emitter.emit("sync:progress", progress);
        };
        state.apply_plan(&plan, &mut report)
    })
    .await
    .map_err(|error| crate::Error::Audio(error.to_string()))?
}

#[tauri::command]
pub fn sync_cancel(state: State<'_, AppState>) {
    state.cancel_sync();
}
