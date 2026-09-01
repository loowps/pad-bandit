use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub const CONFIG_VERSION: u32 = 1;
const RECENT_PROJECTS_KEPT: usize = 10;
const CONFIG_FILE_NAME: &str = "config.json";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub path: PathBuf,
    pub added_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1230.0,
            height: 900.0,
            x: None,
            y: None,
            maximized: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub browse_folders: Vec<Folder>,
    pub card_path: Option<PathBuf>,
    pub recent_projects: Vec<PathBuf>,
    pub theme: Theme,
    pub window: WindowState,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            browse_folders: Vec::new(),
            card_path: None,
            recent_projects: Vec::new(),
            theme: Theme::default(),
            window: WindowState::default(),
        }
    }
}

#[derive(Debug)]
pub struct ConfigStore {
    path: PathBuf,
    config: Config,
}

impl ConfigStore {
    pub fn load(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(CONFIG_FILE_NAME);
        let config = read_or_recover(&path);
        Ok(Self { path, config })
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn add_folder(&mut self, path: PathBuf) -> Result<Folder> {
        if let Some(existing) = self.config.browse_folders.iter().find(|f| f.path == path) {
            return Ok(existing.clone());
        }
        let folder = Folder {
            id: self.next_folder_id(),
            path,
            added_at: now_millis(),
        };
        self.config.browse_folders.push(folder.clone());
        self.save()?;
        Ok(folder)
    }

    pub fn remove_folder(&mut self, id: &str) -> Result<Folder> {
        let index = self
            .config
            .browse_folders
            .iter()
            .position(|folder| folder.id == id)
            .ok_or_else(|| Error::UnknownFolder(id.to_owned()))?;
        let folder = self.config.browse_folders.remove(index);
        self.save()?;
        Ok(folder)
    }

    pub fn set_card_path(&mut self, path: Option<PathBuf>) -> Result<()> {
        self.config.card_path = path;
        self.save()
    }

    pub fn set_theme(&mut self, theme: Theme) -> Result<()> {
        self.config.theme = theme;
        self.save()
    }

    pub fn remember_project(&mut self, path: PathBuf) -> Result<()> {
        self.config.recent_projects.retain(|known| known != &path);
        self.config.recent_projects.insert(0, path);
        self.config.recent_projects.truncate(RECENT_PROJECTS_KEPT);
        self.save()
    }

    pub fn forget_project(&mut self, path: &Path) -> Result<()> {
        self.config.recent_projects.retain(|known| known != path);
        self.save()
    }

    pub fn forget_all_projects(&mut self) -> Result<()> {
        self.config.recent_projects.clear();
        self.save()
    }

    pub fn save(&self) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(&self.config)?;
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(&temporary, &self.path)?;
        Ok(())
    }

    fn next_folder_id(&self) -> String {
        let mut candidate = format!("{:x}", now_millis());
        let mut suffix = 0u32;
        while self
            .config
            .browse_folders
            .iter()
            .any(|folder| folder.id == candidate)
        {
            suffix += 1;
            candidate = format!("{:x}-{suffix}", now_millis());
        }
        candidate
    }
}

fn read_or_recover(path: &Path) -> Config {
    let Ok(bytes) = std::fs::read(path) else {
        return Config::default();
    };
    match serde_json::from_slice::<Config>(&bytes) {
        Ok(config) => config,
        Err(error) => {
            eprintln!(
                "config at {} is unreadable ({error}); starting fresh",
                path.display()
            );
            let backup = path.with_extension(format!("corrupt-{}.json", now_millis()));
            if let Err(error) = std::fs::rename(path, &backup) {
                eprintln!("could not back up the unreadable config: {error}");
            }
            Config::default()
        }
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, ConfigStore) {
        let dir = TempDir::new().expect("temp dir");
        let store = ConfigStore::load(dir.path()).expect("load");
        (dir, store)
    }

    #[test]
    fn a_missing_config_yields_defaults_without_writing_anything() {
        let (dir, store) = store();

        assert_eq!(store.config(), &Config::default());
        assert_eq!(store.config().version, CONFIG_VERSION);
        assert!(!dir.path().join(CONFIG_FILE_NAME).exists());
    }

    #[test]
    fn folders_and_card_path_round_trip_through_a_reload() {
        let (dir, mut store) = store();
        let folder = store
            .add_folder(PathBuf::from("/samples/drums"))
            .expect("add");
        store
            .set_card_path(Some(PathBuf::from("/media/card")))
            .expect("set card path");

        let reloaded = ConfigStore::load(dir.path()).expect("reload");

        assert_eq!(reloaded.config(), store.config());
        assert_eq!(reloaded.config().browse_folders, vec![folder]);
        assert_eq!(
            reloaded.config().card_path,
            Some(PathBuf::from("/media/card"))
        );
    }

    #[test]
    fn adding_the_same_folder_twice_keeps_one_entry() {
        let (_dir, mut store) = store();
        let first = store.add_folder(PathBuf::from("/samples")).expect("add");
        let second = store
            .add_folder(PathBuf::from("/samples"))
            .expect("add again");

        assert_eq!(first, second);
        assert_eq!(store.config().browse_folders.len(), 1);
    }

    #[test]
    fn removing_a_folder_persists_and_an_unknown_id_is_an_error() {
        let (dir, mut store) = store();
        let folder = store.add_folder(PathBuf::from("/samples")).expect("add");

        store.remove_folder(&folder.id).expect("remove");
        assert!(matches!(
            store.remove_folder(&folder.id),
            Err(Error::UnknownFolder(_))
        ));

        let reloaded = ConfigStore::load(dir.path()).expect("reload");
        assert!(reloaded.config().browse_folders.is_empty());
    }

    #[test]
    fn a_corrupt_config_yields_defaults_and_is_backed_up() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join(CONFIG_FILE_NAME);
        std::fs::write(&path, b"{ not json at all").expect("write");

        let store = ConfigStore::load(dir.path()).expect("load");

        assert_eq!(store.config(), &Config::default());
        let backups = std::fs::read_dir(dir.path())
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt-"))
            .count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn a_config_missing_newer_fields_falls_back_to_defaults_per_field() {
        let dir = TempDir::new().expect("temp dir");
        std::fs::write(dir.path().join(CONFIG_FILE_NAME), br#"{"version":1}"#).expect("write");

        let store = ConfigStore::load(dir.path()).expect("load");

        assert_eq!(store.config(), &Config::default());
    }

    #[test]
    fn recent_projects_are_newest_first_deduped_and_capped() {
        let (dir, mut store) = store();

        for index in 0..RECENT_PROJECTS_KEPT + 2 {
            store
                .remember_project(PathBuf::from(format!("/sets/{index}.padbandit")))
                .expect("remember");
        }
        store
            .remember_project(PathBuf::from("/sets/3.padbandit"))
            .expect("remember again");

        let recent = &store.config().recent_projects;
        assert_eq!(recent.len(), RECENT_PROJECTS_KEPT);
        assert_eq!(recent[0], PathBuf::from("/sets/3.padbandit"));
        assert_eq!(recent.iter().filter(|it| it.ends_with("3.padbandit")).count(), 1);

        let reloaded = ConfigStore::load(dir.path()).expect("reload");
        assert_eq!(&reloaded.config().recent_projects, recent);
    }

    #[test]
    fn the_theme_defaults_to_the_system_one_and_survives_a_reload() {
        let (dir, mut store) = store();
        assert_eq!(store.config().theme, Theme::System);

        store.set_theme(Theme::Dark).expect("set theme");

        let reloaded = ConfigStore::load(dir.path()).expect("reload");
        assert_eq!(reloaded.config().theme, Theme::Dark);
    }

    #[test]
    fn a_recent_project_can_be_forgotten_one_at_a_time_or_all_at_once() {
        let (_dir, mut store) = store();
        let kept = PathBuf::from("/sets/keep.padbandit");
        let dropped = PathBuf::from("/sets/drop.padbandit");
        store.remember_project(kept.clone()).expect("remember");
        store.remember_project(dropped.clone()).expect("remember");

        store.forget_project(&dropped).expect("forget");
        assert_eq!(store.config().recent_projects, vec![kept]);

        store.forget_all_projects().expect("forget all");
        assert!(store.config().recent_projects.is_empty());
    }
}
