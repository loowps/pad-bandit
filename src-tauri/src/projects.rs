use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::card::PadEdit;
use crate::error::{Error, Result};

pub const PROJECT_VERSION: u32 = 1;
pub const PROJECT_EXTENSION: &str = "padbandit";
const BACKUPS_DIRECTORY: &str = "backups";
const JOURNAL_FILE_NAME: &str = "recovery.json";
const BACKUPS_KEPT: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AudioRef {
    #[serde(rename = "path")]
    Disk { path: PathBuf },
    #[serde(rename = "card", rename_all = "camelCase")]
    Card {
        origin_slot: u8,
        file_name: String,
        fingerprint: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Intent {
    Keep,
    Sample,
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSlot {
    pub slot: u8,
    pub intent: Intent,
    pub audio: Option<AudioRef>,
    pub edit: PadEdit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub name: String,
    pub saved_at: u64,
    pub card_root: Option<PathBuf>,
    pub slots: Vec<ProjectSlot>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    pub path: PathBuf,
    pub project: Project,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub path: Option<PathBuf>,
    pub project: Project,
}

#[derive(Debug)]
pub struct ProjectStore {
    backups: PathBuf,
    journal: PathBuf,
}

impl ProjectStore {
    pub fn new(app_data: &Path) -> Self {
        Self {
            backups: app_data.join(BACKUPS_DIRECTORY),
            journal: app_data.join(JOURNAL_FILE_NAME),
        }
    }

    pub fn save(&self, path: &Path, project: &Project) -> Result<StoredProject> {
        let name = name_from(path)?;
        let stored = Project {
            version: PROJECT_VERSION,
            name,
            saved_at: now_millis(),
            card_root: project.card_root.clone(),
            slots: project.slots.clone(),
        };

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        self.rotate_backups(path)?;
        write_atomically(path, &serde_json::to_vec_pretty(&stored)?)?;

        Ok(StoredProject {
            path: path.to_path_buf(),
            project: stored,
        })
    }

    pub fn open(&self, path: &Path) -> Result<StoredProject> {
        Ok(StoredProject {
            path: path.to_path_buf(),
            project: read_project(path)?,
        })
    }

    pub fn write_journal(&self, journal: &Journal) -> Result<()> {
        if let Some(parent) = self.journal.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_atomically(&self.journal, &serde_json::to_vec(journal)?)
    }

    pub fn read_journal(&self) -> Option<Journal> {
        let bytes = std::fs::read(&self.journal).ok()?;
        let journal: Journal = serde_json::from_slice(&bytes).ok()?;
        (journal.project.version <= PROJECT_VERSION).then_some(journal)
    }

    pub fn clear_journal(&self) -> Result<()> {
        match std::fs::remove_file(&self.journal) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    fn rotate_backups(&self, path: &Path) -> Result<()> {
        if !path.is_file() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.backups)?;

        for index in (1..BACKUPS_KEPT).rev() {
            let from = self.backup_path(path, index);
            if from.is_file() {
                std::fs::rename(&from, self.backup_path(path, index + 1))?;
            }
        }
        std::fs::copy(path, self.backup_path(path, 1))?;
        Ok(())
    }

    fn backup_path(&self, path: &Path, index: usize) -> PathBuf {
        let stem = path
            .file_stem()
            .map(|stem| slug_of(&stem.to_string_lossy()))
            .unwrap_or_else(|| "project".to_owned());
        self.backups
            .join(format!("{stem}-{:016x}.bak{index}", key_of(path)))
    }
}

fn name_from(path: &Path) -> Result<String> {
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().trim().to_owned())
        .unwrap_or_default();

    if name.is_empty() {
        Err(Error::UnnamedProject)
    } else {
        Ok(name)
    }
}

fn read_project(path: &Path) -> Result<Project> {
    let bytes = std::fs::read(path)?;
    let project: Project = serde_json::from_slice(&bytes)?;
    if project.version > PROJECT_VERSION {
        return Err(Error::UnsupportedProjectVersion {
            version: project.version,
        });
    }
    Ok(project)
}

fn write_atomically(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

fn key_of(path: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    hasher.finish()
}

pub fn slug_of(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'a'..='z' | '0'..='9' | '-' | '_' => character,
            _ => '-',
        })
        .collect();

    let mut collapsed = String::with_capacity(slug.len());
    for character in slug.chars() {
        if character != '-' || !collapsed.ends_with('-') {
            collapsed.push(character);
        }
    }

    let trimmed = collapsed.trim_matches('-').to_owned();
    if trimmed.is_empty() {
        "project".to_owned()
    } else {
        trimmed
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
    use crate::card::{PadSettings, TempoMode};
    use tempfile::TempDir;

    fn edit() -> PadEdit {
        PadEdit {
            settings: PadSettings {
                volume: 127,
                lofi: false,
                looping: false,
                gate: true,
                reverse: false,
                tempo_mode: TempoMode::Off,
                original_tempo: 120.0,
                user_tempo: 120.0,
            },
            start_frame: 0,
            end_frame: 1024,
        }
    }

    fn project() -> Project {
        Project {
            version: PROJECT_VERSION,
            name: String::new(),
            saved_at: 0,
            card_root: Some(PathBuf::from("/media/card")),
            slots: vec![
                ProjectSlot {
                    slot: 0,
                    intent: Intent::Sample,
                    audio: Some(AudioRef::Card {
                        origin_slot: 26,
                        file_name: "C0000003.WAV".to_owned(),
                        fingerprint: "size:512 head:aa tail:bb".to_owned(),
                    }),
                    edit: edit(),
                },
                ProjectSlot {
                    slot: 1,
                    intent: Intent::Clear,
                    audio: None,
                    edit: edit(),
                },
            ],
        }
    }

    struct Fixture {
        _root: TempDir,
        app_data: PathBuf,
        documents: PathBuf,
        store: ProjectStore,
    }

    fn fixture() -> Fixture {
        let root = TempDir::new().expect("temp dir");
        let app_data = root.path().join("data");
        let documents = root.path().join("documents");
        std::fs::create_dir_all(&documents).expect("create dir");

        Fixture {
            store: ProjectStore::new(&app_data),
            _root: root,
            app_data,
            documents,
        }
    }

    impl Fixture {
        fn file(&self, name: &str) -> PathBuf {
            self.documents.join(format!("{name}.{PROJECT_EXTENSION}"))
        }
    }

    #[test]
    fn a_saved_project_reopens_with_every_intent_and_ref_intact() {
        let f = fixture();
        let path = f.file("dj-set");

        let saved = f.store.save(&path, &project()).expect("save");
        let reopened = f.store.open(&path).expect("open");

        assert_eq!(reopened, saved);
        assert_eq!(reopened.project.slots, project().slots);
        assert!(reopened.project.saved_at > 0);
    }

    #[test]
    fn the_file_name_is_the_project_name() {
        let f = fixture();

        let saved = f.store.save(&f.file("DJ set — March"), &project());

        assert_eq!(saved.expect("save").project.name, "DJ set — March");
    }

    #[test]
    fn two_projects_whose_names_share_a_slug_stay_separate_files() {
        let f = fixture();
        let first = f.file("DJ set");
        let second = f.file("DJ  set!");

        f.store.save(&first, &project()).expect("save first");
        let mut smaller = project();
        smaller.slots.truncate(1);
        f.store.save(&second, &smaller).expect("save second");

        assert_eq!(f.store.open(&first).expect("open").project.slots.len(), 2);
        assert_eq!(f.store.open(&second).expect("open").project.slots.len(), 1);
    }

    #[test]
    fn saving_over_a_project_keeps_the_previous_copy_in_app_data_not_beside_it() {
        let f = fixture();
        let path = f.file("live");
        f.store.save(&path, &project()).expect("first save");

        let mut second = project();
        second.slots.truncate(1);
        f.store.save(&path, &second).expect("second save");

        let backups: Vec<PathBuf> = std::fs::read_dir(f.app_data.join(BACKUPS_DIRECTORY))
            .expect("read backups")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .collect();
        assert_eq!(backups.len(), 1);

        let beside: Vec<PathBuf> = std::fs::read_dir(&f.documents)
            .expect("read documents")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .collect();
        assert_eq!(beside, vec![path.clone()]);
        assert_eq!(f.store.open(&path).expect("open").project.slots.len(), 1);
    }

    #[test]
    fn backups_of_same_named_projects_in_different_folders_do_not_collide() {
        let f = fixture();
        let other = f.documents.join("elsewhere");
        std::fs::create_dir_all(&other).expect("create dir");
        let here = f.file("live");
        let there = other.join(format!("live.{PROJECT_EXTENSION}"));

        for path in [&here, &there] {
            f.store.save(path, &project()).expect("first save");
            f.store.save(path, &project()).expect("second save");
        }

        let backups = std::fs::read_dir(f.app_data.join(BACKUPS_DIRECTORY))
            .expect("read backups")
            .count();
        assert_eq!(backups, 2);
    }

    #[test]
    fn a_path_without_a_usable_name_is_refused() {
        let f = fixture();

        assert!(matches!(
            f.store.save(&f.documents.join(".."), &project()),
            Err(Error::UnnamedProject)
        ));
    }

    #[test]
    fn opening_a_project_that_is_not_there_is_an_error_not_a_panic() {
        let f = fixture();

        assert!(f.store.open(&f.file("absent")).is_err());
    }

    #[test]
    fn a_project_from_a_newer_version_is_refused_rather_than_misread() {
        let f = fixture();
        let path = f.file("future");
        f.store.save(&path, &project()).expect("save");
        let mut stored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).expect("read")).expect("parse");
        stored["version"] = serde_json::json!(PROJECT_VERSION + 1);
        std::fs::write(&path, stored.to_string()).expect("write");

        assert!(matches!(
            f.store.open(&path),
            Err(Error::UnsupportedProjectVersion { .. })
        ));
    }

    #[test]
    fn the_journal_remembers_where_the_work_came_from_and_clears_on_exit() {
        let f = fixture();
        let journal = Journal {
            path: Some(f.file("live")),
            project: project(),
        };

        f.store.write_journal(&journal).expect("journal");
        assert!(f.app_data.join(JOURNAL_FILE_NAME).is_file());
        assert_eq!(f.store.read_journal(), Some(journal));

        f.store.clear_journal().expect("clear");
        assert_eq!(f.store.read_journal(), None);
        f.store.clear_journal().expect("clearing twice is fine");
    }

    #[test]
    fn unsaved_work_journals_without_a_path() {
        let f = fixture();
        let journal = Journal {
            path: None,
            project: project(),
        };

        f.store.write_journal(&journal).expect("journal");

        assert_eq!(f.store.read_journal().and_then(|it| it.path), None);
    }

    #[test]
    fn names_that_are_not_file_names_still_get_a_usable_backup_slug() {
        assert_eq!(slug_of("DJ set — March"), "dj-set-march");
        assert_eq!(slug_of("../escape"), "escape");
        assert_eq!(slug_of("***"), "project");
    }
}
