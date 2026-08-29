pub mod audio;
pub mod card;
pub mod commands;
pub mod config;
pub mod error;
pub mod fs;
pub mod menu;
pub mod paths;
pub mod projects;
pub mod state;
pub mod sync;

pub use error::{Error, Result};

use tauri::Manager;

use crate::audio::play::Player;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = app.path();
            let state = AppState::load(&paths.app_config_dir()?, &paths.app_data_dir()?)?;
            menu::apply(app.handle(), &state.recent_projects())?;
            app.manage(state);
            app.manage(Player::spawn(commands::PlaybackBridge::new(
                app.handle().clone(),
            )));
            Ok(())
        })
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            commands::config_get,
            commands::config_add_folder,
            commands::config_remove_folder,
            commands::config_set_card_path,
            commands::pick_folder,
            commands::list_dir,
            commands::card_read,
            commands::card_presence,
            commands::sync_preflight,
            commands::sync_apply,
            commands::sync_cancel,
            commands::project_pick_to_save,
            commands::project_pick_to_open,
            commands::project_save,
            commands::project_open,
            commands::project_recent,
            commands::project_forget_recent,
            commands::window_set_title,
            commands::journal_write,
            commands::journal_read,
            commands::journal_clear,
            commands::audio_peaks,
            commands::audio_play,
            commands::audio_stop,
            commands::audio_set_gain,
            commands::audio_seek,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
