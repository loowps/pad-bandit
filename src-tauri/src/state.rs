use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::card::{CardState, LoadedCard};
use crate::config::{Config, ConfigStore, Theme};
use crate::error::{Error, Result};
use crate::paths::{FileGrants, Scopes};
use crate::projects::{Journal, Project, ProjectStore, StoredProject};
use crate::sync::{Preflight, SyncPlan};

pub struct AppState {
    inner: Mutex<Inner>,
    cancellation: crate::sync::apply::Cancellation,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub outcome: crate::sync::apply::SyncOutcome,
    pub card: CardState,
}

struct Inner {
    store: ConfigStore,
    scopes: Scopes,
    grants: FileGrants,
    card: Option<LoadedCard>,
}

impl AppState {
    pub fn load(config_dir: &Path, app_data_dir: &Path) -> Result<Self> {
        let store = ConfigStore::load(config_dir)?;
        let mut scopes = Scopes::new(app_data_dir)?;
        scopes.replace_read_roots(store.config().browse_folders.iter().map(|f| &f.path));
        if let Some(card_path) = store.config().card_path.clone()
            && let Err(error) = scopes.set_card_root(Some(&card_path))
        {
            eprintln!("card at {} is unavailable: {error}", card_path.display());
        }

        let mut grants = FileGrants::default();
        grants.grant_all(&store.config().recent_projects);

        Ok(Self {
            inner: Mutex::new(Inner {
                store,
                scopes,
                grants,
                card: None,
            }),
            cancellation: crate::sync::apply::Cancellation::default(),
        })
    }

    pub fn cancel_sync(&self) {
        self.cancellation.cancel();
    }

    pub fn apply_plan(
        &self,
        plan: &SyncPlan,
        report: &mut dyn FnMut(crate::sync::apply::Progress),
    ) -> Result<SyncResult> {
        self.cancellation.reset();

        let mut inner = self.lock();
        let card_path = inner
            .store
            .config()
            .card_path
            .clone()
            .ok_or(Error::NoCardSelected)?;
        let app_data = inner.scopes.app_data().to_path_buf();
        let loaded = crate::card::read_card(&inner.scopes, &card_path)?;

        if crate::sync::card_fingerprint(&loaded) != plan.card_fingerprint {
            return Err(Error::CardChanged);
        }

        let outcome = {
            let mut context = crate::sync::apply::Apply {
                scopes: &inner.scopes,
                card: &loaded,
                app_data: &app_data,
                cancel: Some(self.cancellation.handle()),
                report,
            };
            crate::sync::apply::apply_plan(&mut context, plan)?
        };

        let reread = crate::card::read_card(&inner.scopes, &card_path)?;
        let card = reread.state();
        inner.card = Some(reread);
        Ok(SyncResult { outcome, card })
    }

    pub fn config(&self) -> Config {
        self.lock().store.config().clone()
    }

    pub fn add_browse_folder(&self, path: &Path) -> Result<Config> {
        let mut inner = self.lock();
        let resolved = inner.scopes.add_read_root(path)?;
        let known = inner
            .store
            .config()
            .browse_folders
            .iter()
            .any(|folder| folder.path == resolved);

        if let Err(error) = inner.store.add_folder(resolved.clone()) {
            if !known {
                inner.scopes.remove_read_root(&resolved);
            }
            return Err(error);
        }
        Ok(inner.store.config().clone())
    }

    pub fn remove_browse_folder(&self, id: &str) -> Result<Config> {
        let mut inner = self.lock();
        let folder = inner.store.remove_folder(id)?;
        inner.scopes.remove_read_root(&folder.path);
        Ok(inner.store.config().clone())
    }

    pub fn set_card_path(&self, path: Option<&Path>) -> Result<Config> {
        let mut inner = self.lock();
        let resolved = inner.scopes.set_card_root(path)?;
        inner.store.set_card_path(resolved)?;
        inner.card = None;
        Ok(inner.store.config().clone())
    }

    pub fn set_theme(&self, theme: Theme) -> Result<Config> {
        let mut inner = self.lock();
        inner.store.set_theme(theme)?;
        Ok(inner.store.config().clone())
    }

    pub fn app_data(&self) -> std::path::PathBuf {
        self.lock().scopes.app_data().to_path_buf()
    }

    fn projects(&self) -> ProjectStore {
        ProjectStore::new(&self.app_data())
    }

    pub fn recent_projects(&self) -> Vec<std::path::PathBuf> {
        self.lock().store.config().recent_projects.clone()
    }

    pub fn grant_project_file(&self, path: &Path) -> Result<std::path::PathBuf> {
        self.lock().grants.grant(path)
    }

    pub fn save_project(&self, path: &Path, project: &Project) -> Result<StoredProject> {
        let mut inner = self.lock();
        let granted = inner.grants.allows(path)?;
        let stored = ProjectStore::new(inner.scopes.app_data()).save(&granted, project)?;
        inner.store.remember_project(granted)?;
        Ok(stored)
    }

    pub fn open_project(&self, path: &Path) -> Result<StoredProject> {
        let mut inner = self.lock();
        let granted = inner.grants.allows(path)?;
        let stored = ProjectStore::new(inner.scopes.app_data()).open(&granted)?;
        inner.store.remember_project(granted)?;
        Ok(stored)
    }

    pub fn forget_recent_projects(&self) -> Result<Config> {
        let mut inner = self.lock();
        inner.store.forget_all_projects()?;
        inner.grants.clear();
        Ok(inner.store.config().clone())
    }

    pub fn forget_recent_project(&self, path: &Path) -> Result<Config> {
        let mut inner = self.lock();
        inner.store.forget_project(path)?;
        inner.grants.revoke(path);
        Ok(inner.store.config().clone())
    }

    pub fn write_journal(&self, journal: &Journal) -> Result<()> {
        self.projects().write_journal(journal)
    }

    pub fn read_journal(&self) -> Option<Journal> {
        self.projects().read_journal()
    }

    pub fn clear_journal(&self) -> Result<()> {
        self.projects().clear_journal()
    }

    pub fn read_card(&self) -> Result<CardState> {
        let mut inner = self.lock();
        let card_path = inner
            .store
            .config()
            .card_path
            .clone()
            .ok_or(Error::NoCardSelected)?;

        let loaded = crate::card::read_card(&inner.scopes, &card_path)?;
        let state = loaded.state();
        inner.card = Some(loaded);
        Ok(state)
    }

    pub fn card_presence(&self) -> crate::card::CardPresence {
        let inner = self.lock();
        match inner.store.config().card_path.clone() {
            Some(path) => crate::card::presence(&inner.scopes, &path),
            None => crate::card::CardPresence { present: false, fingerprint: None },
        }
    }

    pub fn preflight(&self, plan: &SyncPlan) -> Result<Preflight> {
        let mut inner = self.lock();
        let card_path = inner
            .store
            .config()
            .card_path
            .clone()
            .ok_or(Error::NoCardSelected)?;

        let loaded = crate::card::read_card(&inner.scopes, &card_path)?;
        let free = crate::sync::free_space(&card_path)?;
        let report = crate::sync::preflight(
            &inner.scopes,
            &loaded,
            plan,
            &crate::sync::Budget::on(free),
        );
        inner.card = Some(loaded);
        Ok(report)
    }

    pub fn with_scopes<T>(&self, read: impl FnOnce(&Scopes) -> T) -> T {
        read(&self.lock().scopes)
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Fixture {
        _root: TempDir,
        config_dir: std::path::PathBuf,
        browse: std::path::PathBuf,
        card: std::path::PathBuf,
        state: AppState,
    }

    fn fixture() -> Fixture {
        let root = TempDir::new().expect("temp dir");
        let config_dir = root.path().join("config");
        let app_data = root.path().join("data");
        let browse = root.path().join("browse");
        let card = root.path().join("card");
        for dir in [&browse, &card] {
            std::fs::create_dir_all(dir).expect("create dir");
        }
        let state = AppState::load(&config_dir, &app_data).expect("load state");

        Fixture {
            _root: root,
            config_dir,
            browse,
            card,
            state,
        }
    }

    #[test]
    fn an_added_folder_becomes_a_read_root_and_survives_a_restart() {
        let f = fixture();

        let config = f.state.add_browse_folder(&f.browse).expect("add folder");
        assert_eq!(config.browse_folders.len(), 1);

        let sample = f.browse.join("kick.wav");
        f.state
            .with_scopes(|scopes| scopes.readable(&sample))
            .expect("readable");
        assert!(
            f.state
                .with_scopes(|scopes| scopes.writable(&sample))
                .is_err()
        );

        let restarted =
            AppState::load(&f.config_dir, f._root.path().join("data").as_path()).expect("restart");
        assert_eq!(restarted.config().browse_folders, config.browse_folders);
        assert!(
            restarted
                .with_scopes(|scopes| scopes.readable(&sample))
                .is_ok()
        );
    }

    #[test]
    fn removing_a_folder_revokes_its_read_scope() {
        let f = fixture();
        let config = f.state.add_browse_folder(&f.browse).expect("add folder");
        let id = &config.browse_folders[0].id;

        f.state.remove_browse_folder(id).expect("remove folder");

        assert!(
            f.state
                .with_scopes(|scopes| scopes.readable(&f.browse.join("kick.wav")))
                .is_err()
        );
    }

    #[test]
    fn setting_the_card_path_opens_the_write_scope_and_clearing_it_closes_it() {
        let f = fixture();
        let pad_info = f.card.join("PAD_INFO.BIN");

        f.state.set_card_path(Some(&f.card)).expect("set card path");
        assert!(
            f.state
                .with_scopes(|scopes| scopes.writable(&pad_info))
                .is_ok()
        );

        f.state.set_card_path(None).expect("clear card path");
        assert!(
            f.state
                .with_scopes(|scopes| scopes.writable(&pad_info))
                .is_err()
        );
        assert_eq!(f.state.config().card_path, None);
    }

    #[test]
    fn the_chosen_theme_persists_across_a_restart() {
        let f = fixture();

        let config = f.state.set_theme(Theme::Dark).expect("set theme");
        assert_eq!(config.theme, Theme::Dark);

        let restarted =
            AppState::load(&f.config_dir, f._root.path().join("data").as_path()).expect("restart");
        assert_eq!(restarted.config().theme, Theme::Dark);
    }

    #[test]
    fn a_folder_that_no_longer_exists_is_rejected_rather_than_stored() {
        let f = fixture();
        let missing = f.browse.join("gone");

        assert!(f.state.add_browse_folder(&missing).is_err());
        assert!(f.state.config().browse_folders.is_empty());
    }
}
