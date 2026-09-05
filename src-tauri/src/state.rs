use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, TryLockError};

use crate::card::CardState;
use crate::config::{Config, ConfigStore, Theme};
use crate::error::{Error, Result};
use crate::index::{Indexes, SearchOutcome};
use crate::paths::{FileGrants, Scopes};
use crate::projects::{Journal, Project, ProjectStore, StoredProject};
use crate::sync::{Preflight, SyncPlan};

pub struct AppState {
    inner: Mutex<Inner>,
    indexes: Mutex<Indexes>,
    syncing: Mutex<()>,
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
            }),
            indexes: Mutex::new(Indexes::default()),
            syncing: Mutex::new(()),
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
        let _running = self.claim_sync()?;
        self.cancellation.reset();

        let (scopes, card_path) = self.card_scope()?;
        let app_data = scopes.app_data().to_path_buf();
        let loaded = crate::card::read_card(&scopes, &card_path)?;

        if crate::sync::card_fingerprint(&loaded) != plan.card_fingerprint {
            return Err(Error::CardChanged);
        }

        let outcome = {
            let mut context = crate::sync::apply::Apply {
                scopes: &scopes,
                card: &loaded,
                app_data: &app_data,
                cancel: Some(self.cancellation.handle()),
                report,
            };
            crate::sync::apply::apply_plan(&mut context, plan)?
        };

        let card = crate::card::read_card(&scopes, &card_path)?.state();
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
        let (config, removed) = {
            let mut inner = self.lock();
            let folder = inner.store.remove_folder(id)?;
            inner.scopes.remove_read_root(&folder.path);
            (inner.store.config().clone(), folder.path)
        };
        self.lock_indexes().forget(&removed);
        Ok(config)
    }

    pub fn browse_roots(&self) -> Vec<PathBuf> {
        self.lock()
            .store
            .config()
            .browse_folders
            .iter()
            .map(|folder| folder.path.clone())
            .collect()
    }

    pub fn is_indexing(&self) -> bool {
        self.lock_indexes().is_building()
    }

    pub fn search_samples(&self, query: &str, limit: usize) -> SearchOutcome {
        self.lock_indexes().search(query, limit)
    }

    pub fn reindex(&self, root: &Path) {
        let scopes = self.scopes();
        self.lock_indexes().mark_building(root);

        match crate::index::build(&scopes, root) {
            Ok(built) => self.lock_indexes().store(root, built),
            Err(error) => {
                eprintln!("could not index {}: {error}", root.display());
                self.lock_indexes().mark_failed(root);
            }
        }
    }

    pub fn reindex_all(&self, force: bool) {
        let roots = self.browse_roots();
        self.lock_indexes().retain_roots(&roots);

        for root in &roots {
            if force || !self.lock_indexes().is_ready(root) {
                self.reindex(root);
            }
        }
    }

    pub fn set_card_path(&self, path: Option<&Path>) -> Result<Config> {
        if self.is_syncing() {
            return Err(Error::SyncInProgress);
        }
        let mut inner = self.lock();
        let resolved = inner.scopes.set_card_root(path)?;
        inner.store.set_card_path(resolved)?;
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
        let (scopes, card_path) = self.card_scope()?;
        Ok(crate::card::read_card(&scopes, &card_path)?.state())
    }

    pub fn card_presence(&self) -> crate::card::CardPresence {
        match self.card_scope() {
            Ok((scopes, card_path)) => crate::card::presence(&scopes, &card_path),
            Err(_) => crate::card::CardPresence {
                present: false,
                fingerprint: None,
            },
        }
    }

    pub fn preflight(&self, plan: &SyncPlan) -> Result<Preflight> {
        let (scopes, card_path) = self.card_scope()?;
        let loaded = crate::card::read_card(&scopes, &card_path)?;
        let free = crate::sync::free_space(&card_path)?;
        Ok(crate::sync::preflight(
            &scopes,
            &loaded,
            plan,
            &crate::sync::Budget::on(free),
        ))
    }

    pub fn scopes(&self) -> Scopes {
        self.lock().scopes.clone()
    }

    fn card_scope(&self) -> Result<(Scopes, PathBuf)> {
        let inner = self.lock();
        let card_path = inner
            .store
            .config()
            .card_path
            .clone()
            .ok_or(Error::NoCardSelected)?;
        Ok((inner.scopes.clone(), card_path))
    }

    fn claim_sync(&self) -> Result<MutexGuard<'_, ()>> {
        match self.syncing.try_lock() {
            Ok(guard) => Ok(guard),
            Err(TryLockError::Poisoned(poisoned)) => Ok(poisoned.into_inner()),
            Err(TryLockError::WouldBlock) => Err(Error::SyncInProgress),
        }
    }

    fn is_syncing(&self) -> bool {
        matches!(self.syncing.try_lock(), Err(TryLockError::WouldBlock))
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_indexes(&self) -> MutexGuard<'_, Indexes> {
        self.indexes
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
        f.state.scopes().readable(&sample).expect("readable");
        assert!(f.state.scopes().writable(&sample).is_err());

        let restarted =
            AppState::load(&f.config_dir, f._root.path().join("data").as_path()).expect("restart");
        assert_eq!(restarted.config().browse_folders, config.browse_folders);
        assert!(restarted.scopes().readable(&sample).is_ok());
    }

    #[test]
    fn removing_a_folder_revokes_its_read_scope() {
        let f = fixture();
        let config = f.state.add_browse_folder(&f.browse).expect("add folder");
        let id = &config.browse_folders[0].id;

        f.state.remove_browse_folder(id).expect("remove folder");

        assert!(
            f.state
                .scopes()
                .readable(&f.browse.join("kick.wav"))
                .is_err()
        );
    }

    #[test]
    fn setting_the_card_path_opens_the_write_scope_and_clearing_it_closes_it() {
        let f = fixture();
        let pad_info = f.card.join("PAD_INFO.BIN");

        f.state.set_card_path(Some(&f.card)).expect("set card path");
        assert!(f.state.scopes().writable(&pad_info).is_ok());

        f.state.set_card_path(None).expect("clear card path");
        assert!(f.state.scopes().writable(&pad_info).is_err());
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

    fn write_one_slot_card(card_root: &Path) {
        let samples = crate::card::sample_directory(card_root);
        std::fs::create_dir_all(&samples).expect("card dirs");

        let mut table = vec![0u8; crate::card::PAD_COUNT * 32];
        let end = 512u32 + 4_000;
        table[0..4].copy_from_slice(&512u32.to_be_bytes());
        table[4..8].copy_from_slice(&end.to_be_bytes());
        table[8..12].copy_from_slice(&512u32.to_be_bytes());
        table[12..16].copy_from_slice(&end.to_be_bytes());
        table[16] = 127;
        table[19] = 1;
        table[21] = 1;
        table[22] = 2;
        table[24..28].copy_from_slice(&1199u32.to_be_bytes());
        table[28..32].copy_from_slice(&1199u32.to_be_bytes());
        std::fs::write(samples.join(crate::card::PAD_INFO_FILE_NAME), &table).expect("pad info");

        let sample = samples.join(crate::card::sample_file_name(0));
        crate::audio::testing::write_silence_wav(&sample, 44_100, 1_000, 2);
        crate::card::write_sample_index(&sample, 0).expect("sample index");
    }

    fn settings_only_plan(fingerprint: String) -> SyncPlan {
        SyncPlan {
            card_fingerprint: fingerprint,
            slots: vec![crate::sync::PlannedSlot {
                slot: 0,
                action: crate::sync::PlannedAction::Settings,
                edit: crate::card::PadEdit {
                    settings: crate::card::PadSettings {
                        volume: 100,
                        lofi: false,
                        looping: false,
                        gate: true,
                        reverse: false,
                        tempo_mode: crate::card::TempoMode::Off,
                        original_tempo: 120.0,
                        user_tempo: 120.0,
                    },
                    start_frame: 0,
                    end_frame: 0,
                },
            }],
        }
    }

    fn card_under_sync() -> (Fixture, SyncPlan) {
        let f = fixture();
        write_one_slot_card(&f.card);
        f.state.set_card_path(Some(&f.card)).expect("set card path");
        let plan = settings_only_plan(f.state.read_card().expect("read card").fingerprint);
        (f, plan)
    }

    #[test]
    fn a_running_sync_still_answers_reads_from_another_caller() {
        let (f, plan) = card_under_sync();
        let mut probed = None;

        let mut report = |_: crate::sync::apply::Progress| {
            probed.get_or_insert_with(|| {
                (
                    f.state.card_presence().present,
                    f.state.config().card_path.is_some(),
                    f.state.scopes().writable(&f.card.join("x")).is_ok(),
                )
            });
        };
        f.state.apply_plan(&plan, &mut report).expect("apply");

        assert_eq!(probed, Some((true, true, true)));
    }

    #[test]
    fn a_running_sync_refuses_a_second_sync_and_a_card_change() {
        let (f, plan) = card_under_sync();
        let mut refusals = None;

        let mut report = |_: crate::sync::apply::Progress| {
            refusals.get_or_insert_with(|| {
                let second = f.state.apply_plan(&plan, &mut |_| {}).unwrap_err();
                let retarget = f.state.set_card_path(None).unwrap_err();
                (second.to_string(), retarget.to_string())
            });
        };
        f.state.apply_plan(&plan, &mut report).expect("apply");

        let busy = Error::SyncInProgress.to_string();
        assert_eq!(refusals, Some((busy.clone(), busy)));
        assert!(f.state.config().card_path.is_some());
    }

    #[test]
    fn the_card_can_be_retargeted_once_the_sync_has_finished() {
        let (f, plan) = card_under_sync();

        f.state.apply_plan(&plan, &mut |_| {}).expect("apply");

        f.state.set_card_path(None).expect("clear card path");
        assert_eq!(f.state.config().card_path, None);
    }
}
