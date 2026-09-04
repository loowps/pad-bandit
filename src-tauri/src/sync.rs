use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::audio::encode;
use crate::card::{LoadedCard, PadEdit, PAD_COUNT};
use crate::error::Result;
use crate::paths::Scopes;

pub mod apply;

pub const MAX_SAMPLE_BYTES: u64 = 1_905_120_000;
pub const FREE_SPACE_MARGIN: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlannedAction {
    Settings,
    #[serde(rename_all = "camelCase")]
    Move {
        from_slot: u8,
    },
    #[serde(rename_all = "camelCase")]
    Write {
        source: PathBuf,
    },
    Delete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedSlot {
    pub slot: u8,
    pub action: PlannedAction,
    pub edit: PadEdit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub card_fingerprint: String,
    pub slots: Vec<PlannedSlot>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Problem {
    CardChanged,
    #[serde(rename_all = "camelCase")]
    UnknownSlot {
        slot: u8,
    },
    #[serde(rename_all = "camelCase")]
    NotEnoughRoom {
        needed: u64,
        available: u64,
    },
    #[serde(rename_all = "camelCase")]
    SourceUnreadable {
        slot: u8,
        source: PathBuf,
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    SampleTooLong {
        slot: u8,
        bytes: u64,
        cap: u64,
    },
    #[serde(rename_all = "camelCase")]
    NothingAtOriginSlot {
        slot: u8,
        from_slot: u8,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizedSlot {
    pub slot: u8,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    pub problems: Vec<Problem>,
    pub sizes: Vec<SizedSlot>,
    pub bytes_to_write: u64,
    pub bytes_to_free: u64,
    pub free_space: u64,
}

impl Preflight {
    pub fn ok(&self) -> bool {
        self.problems.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub free_space: u64,
    pub max_sample_bytes: u64,
    pub margin: u64,
}

impl Budget {
    pub fn on(free_space: u64) -> Self {
        Self {
            free_space,
            max_sample_bytes: MAX_SAMPLE_BYTES,
            margin: FREE_SPACE_MARGIN,
        }
    }
}

pub fn card_fingerprint(card: &LoadedCard) -> String {
    card.state().fingerprint
}

pub fn preflight(scopes: &Scopes, card: &LoadedCard, plan: &SyncPlan, budget: &Budget) -> Preflight {
    let mut problems = Vec::new();
    let mut sizes = Vec::new();
    let mut bytes_to_write = 0u64;
    let mut bytes_to_free = 0u64;

    if card_fingerprint(card) != plan.card_fingerprint {
        problems.push(Problem::CardChanged);
    }

    let occupied = occupied_sizes(card);

    for planned in &plan.slots {
        let slot = planned.slot;
        if usize::from(slot) >= PAD_COUNT {
            problems.push(Problem::UnknownSlot { slot });
            continue;
        }

        match &planned.action {
            PlannedAction::Settings => {}
            PlannedAction::Delete => {
                bytes_to_free += occupied.get(&slot).copied().unwrap_or_default();
            }
            PlannedAction::Move { from_slot } => {
                if !occupied.contains_key(from_slot) {
                    problems.push(Problem::NothingAtOriginSlot {
                        slot,
                        from_slot: *from_slot,
                    });
                }
            }
            PlannedAction::Write { source } => {
                bytes_to_free += occupied.get(&slot).copied().unwrap_or_default();
                match measure(scopes, source) {
                    Ok(bytes) => {
                        sizes.push(SizedSlot { slot, bytes });
                        bytes_to_write += bytes;
                        if bytes > budget.max_sample_bytes {
                            problems.push(Problem::SampleTooLong {
                                slot,
                                bytes,
                                cap: budget.max_sample_bytes,
                            });
                        }
                    }
                    Err(reason) => problems.push(Problem::SourceUnreadable {
                        slot,
                        source: source.clone(),
                        reason,
                    }),
                }
            }
        }
    }

    let needed = bytes_to_write.saturating_sub(bytes_to_free) + budget.margin;
    if needed > budget.free_space {
        problems.push(Problem::NotEnoughRoom {
            needed,
            available: budget.free_space,
        });
    }

    Preflight {
        problems,
        sizes,
        bytes_to_write,
        bytes_to_free,
        free_space: budget.free_space,
    }
}

fn measure(scopes: &Scopes, source: &Path) -> std::result::Result<u64, String> {
    let readable = scopes.readable(source).map_err(|error| error.to_string())?;
    if !readable.is_file() {
        return Err("the file is no longer there".to_owned());
    }
    encode::estimate(&readable)
        .map(|sample| sample.bytes)
        .map_err(|error| error.to_string())
}

fn occupied_sizes(card: &LoadedCard) -> BTreeMap<u8, u64> {
    card.state()
        .slots
        .into_iter()
        .filter_map(|slot| slot.sample.map(|sample| (slot.slot, sample.size_bytes)))
        .collect()
}

pub fn free_space(path: &Path) -> Result<u64> {
    platform::free_space(path)
}

#[cfg(windows)]
mod platform {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    use crate::error::{Error, Result};

    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_to_caller: *mut u64,
            total: *mut u64,
            total_free: *mut u64,
        ) -> i32;
    }

    pub fn free_space(path: &Path) -> Result<u64> {
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        wide.push(0);

        let mut available = 0u64;
        let mut total = 0u64;
        let mut total_free = 0u64;
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut total_free)
        };

        if ok == 0 {
            return Err(Error::Io(std::io::Error::last_os_error()));
        }
        Ok(available)
    }
}

#[cfg(unix)]
mod platform {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    use crate::error::{Error, Result};

    pub fn free_space(path: &Path) -> Result<u64> {
        let raw = CString::new(path.as_os_str().as_bytes())
            .map_err(|_| Error::UnresolvablePath(path.to_path_buf()))?;
        let mut stats = unsafe { std::mem::zeroed::<libc::statvfs>() };

        if unsafe { libc::statvfs(raw.as_ptr(), &mut stats) } != 0 {
            return Err(Error::Io(std::io::Error::last_os_error()));
        }
        Ok(stats.f_bavail as u64 * stats.f_frsize as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::testing;
    use crate::card::{PadSettings, TempoMode, read_card, sample_file_name};
    use tempfile::TempDir;

    struct Fixture {
        _root: TempDir,
        card_root: PathBuf,
        browse: PathBuf,
        scopes: Scopes,
    }

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
            end_frame: 0,
        }
    }

    fn fixture() -> Fixture {
        let root = TempDir::new().expect("temp dir");
        let app_data = root.path().join("data");
        let card_root = root.path().join("card");
        let browse = root.path().join("browse");
        let samples = crate::card::sample_directory(&card_root);
        std::fs::create_dir_all(&samples).expect("card dirs");
        std::fs::create_dir_all(&browse).expect("browse dir");

        let mut table = vec![0u8; PAD_COUNT * 32];
        for slot in 0..2usize {
            let at = slot * 32;
            table[at..at + 4].copy_from_slice(&512u32.to_be_bytes());
            table[at + 4..at + 8].copy_from_slice(&(512u32 + 4_000).to_be_bytes());
            table[at + 8..at + 12].copy_from_slice(&512u32.to_be_bytes());
            table[at + 12..at + 16].copy_from_slice(&(512u32 + 4_000).to_be_bytes());
            table[at + 22] = 2;
        }
        std::fs::write(samples.join(crate::card::PAD_INFO_FILE_NAME), &table).expect("pad info");
        for slot in 0..2u8 {
            testing::write_silence_wav(&samples.join(sample_file_name(slot)), 44_100, 1_000, 2);
        }

        let mut scopes = Scopes::new(&app_data).expect("scopes");
        scopes.set_card_root(Some(&card_root)).expect("card root");
        scopes.add_read_root(&browse).expect("browse root");

        Fixture {
            _root: root,
            card_root,
            browse,
            scopes,
        }
    }

    impl Fixture {
        fn card(&self) -> LoadedCard {
            read_card(&self.scopes, &self.card_root).expect("read card")
        }

        fn source(&self, name: &str, frames: u32) -> PathBuf {
            let path = self.browse.join(name);
            testing::write_silence_wav(&path, 44_100, frames, 2);
            path
        }

        fn card_sample_size(&self, slot: u8) -> u64 {
            std::fs::metadata(crate::card::sample_directory(&self.card_root).join(sample_file_name(slot)))
                .expect("card sample")
                .len()
        }

        fn plan(&self, slots: Vec<PlannedSlot>) -> SyncPlan {
            SyncPlan {
                card_fingerprint: card_fingerprint(&self.card()),
                slots,
            }
        }
    }

    fn write_slot(slot: u8, source: PathBuf) -> PlannedSlot {
        PlannedSlot {
            slot,
            action: PlannedAction::Write { source },
            edit: edit(),
        }
    }

    #[test]
    fn a_plan_whose_sources_are_all_present_passes() {
        let f = fixture();
        let plan = f.plan(vec![write_slot(5, f.source("kick.wav", 1_000))]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(report.ok(), "{:?}", report.problems);
        assert_eq!(report.sizes, vec![SizedSlot { slot: 5, bytes: 512 + 4_000 }]);
        assert_eq!(report.bytes_to_write, 512 + 4_000);
        assert_eq!(report.bytes_to_free, 0);
    }

    #[test]
    fn a_source_that_vanished_is_named_with_its_slot() {
        let f = fixture();
        let missing = f.browse.join("gone.wav");
        let plan = f.plan(vec![write_slot(5, missing.clone())]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(!report.ok());
        assert!(matches!(
            report.problems.first(),
            Some(Problem::SourceUnreadable { slot: 5, source, .. }) if source == &missing
        ));
    }

    #[test]
    fn a_source_outside_every_read_root_is_refused_rather_than_measured() {
        let f = fixture();
        let outside = f._root.path().join("elsewhere.wav");
        testing::write_silence_wav(&outside, 44_100, 10, 2);
        let plan = f.plan(vec![write_slot(5, outside)]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(matches!(
            report.problems.first(),
            Some(Problem::SourceUnreadable { slot: 5, .. })
        ));
    }

    #[test]
    fn replacing_a_pad_counts_the_bytes_its_old_sample_gives_back() {
        let f = fixture();
        let existing = f.card_sample_size(0);
        let plan = f.plan(vec![write_slot(0, f.source("kick.wav", 1_000))]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(report.ok(), "{:?}", report.problems);
        assert_eq!(report.bytes_to_write, 512 + 4_000);
        assert_eq!(report.bytes_to_free, existing);
    }

    #[test]
    fn deleting_frees_bytes_and_writes_none() {
        let f = fixture();
        let plan = f.plan(vec![PlannedSlot {
            slot: 1,
            action: PlannedAction::Delete,
            edit: edit(),
        }]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(report.ok(), "{:?}", report.problems);
        assert_eq!(report.bytes_to_write, 0);
        assert_eq!(report.bytes_to_free, f.card_sample_size(1));
    }

    #[test]
    fn a_card_with_no_room_is_refused_before_anything_is_written() {
        let f = fixture();
        let plan = f.plan(vec![write_slot(5, f.source("kick.wav", 1_000))]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1_000));

        assert!(matches!(
            report.problems.first(),
            Some(Problem::NotEnoughRoom { available: 1_000, .. })
        ));
    }

    #[test]
    fn the_free_space_check_allows_for_what_the_plan_deletes() {
        let f = fixture();
        let plan = f.plan(vec![write_slot(0, f.source("kick.wav", 200))]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(FREE_SPACE_MARGIN));

        assert!(report.bytes_to_write < report.bytes_to_free, "the replacement must be smaller");
        assert!(report.ok(), "{:?}", report.problems);
    }

    #[test]
    fn a_sample_over_the_per_sample_cap_is_refused_even_with_a_card_full_of_room() {
        let f = fixture();
        let plan = f.plan(vec![write_slot(5, f.source("long.wav", 1_000))]);
        let budget = Budget {
            max_sample_bytes: 1_000,
            ..Budget::on(u64::MAX)
        };

        let report = preflight(&f.scopes, &f.card(), &plan, &budget);

        assert!(matches!(
            report.problems.first(),
            Some(Problem::SampleTooLong {
                slot: 5,
                bytes: 4_512,
                cap: 1_000
            })
        ));
    }

    #[test]
    fn the_cap_is_the_one_roland_documents_for_a_single_sample() {
        assert_eq!(MAX_SAMPLE_BYTES, 180 * 60 * 44_100 * 2 * 2);
    }

    #[test]
    fn a_move_from_an_empty_slot_is_refused() {
        let f = fixture();
        let plan = f.plan(vec![PlannedSlot {
            slot: 5,
            action: PlannedAction::Move { from_slot: 99 },
            edit: edit(),
        }]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(matches!(
            report.problems.first(),
            Some(Problem::NothingAtOriginSlot {
                slot: 5,
                from_slot: 99
            })
        ));
    }

    #[test]
    fn a_slot_outside_the_card_is_refused() {
        let f = fixture();
        let plan = f.plan(vec![PlannedSlot {
            slot: 200,
            action: PlannedAction::Delete,
            edit: edit(),
        }]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(matches!(
            report.problems.first(),
            Some(Problem::UnknownSlot { slot: 200 })
        ));
    }

    #[test]
    fn a_card_that_changed_under_the_plan_is_refused_whole() {
        let f = fixture();
        let plan = SyncPlan {
            card_fingerprint: "not the card in front of us".to_owned(),
            slots: vec![write_slot(5, f.source("kick.wav", 1_000))],
        };

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(1 << 30));

        assert!(report.problems.contains(&Problem::CardChanged));
    }

    #[test]
    fn the_fingerprint_follows_the_card_not_the_reading_of_it() {
        let f = fixture();
        let before = card_fingerprint(&f.card());

        assert_eq!(before, card_fingerprint(&f.card()));

        let samples = crate::card::sample_directory(&f.card_root);
        testing::write_silence_wav(&samples.join(sample_file_name(0)), 44_100, 2_000, 2);

        assert_ne!(before, card_fingerprint(&f.card()));
    }

    #[test]
    fn free_space_reports_something_plausible_for_the_temp_directory() {
        let f = fixture();

        let free = free_space(&f.card_root).expect("free space");

        assert!(free > 0);
    }

    #[test]
    fn a_settings_only_change_needs_no_room_at_all() {
        let f = fixture();
        let plan = f.plan(vec![PlannedSlot {
            slot: 0,
            action: PlannedAction::Settings,
            edit: edit(),
        }]);

        let report = preflight(&f.scopes, &f.card(), &plan, &Budget::on(FREE_SPACE_MARGIN));

        assert!(report.ok(), "{:?}", report.problems);
        assert_eq!((report.bytes_to_write, report.bytes_to_free), (0, 0));
    }
}
