use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::card::CardState;
use crate::error::Result;
use crate::paths::simplified;
use crate::sync::{PlannedAction, SyncPlan};

const SOURCES_FILE_NAME: &str = "card-sources.json";

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSources {
    by_fingerprint: BTreeMap<String, PathBuf>,
}

impl CardSources {
    pub fn load(app_data: &Path) -> Self {
        std::fs::read(app_data.join(SOURCES_FILE_NAME))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, app_data: &Path) -> Result<()> {
        std::fs::create_dir_all(app_data)?;
        let path = app_data.join(SOURCES_FILE_NAME);
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, serde_json::to_vec(self)?)?;
        std::fs::rename(&temporary, &path)?;
        Ok(())
    }

    pub fn attach_to(&self, card: &mut CardState) {
        for sample in card
            .slots
            .iter_mut()
            .filter_map(|slot| slot.sample.as_mut())
        {
            sample.source_path = self.by_fingerprint.get(&sample.fingerprint).cloned();
        }
    }

    pub fn learn_from_sync(
        &mut self,
        before: &CardState,
        after: &CardState,
        plan: &SyncPlan,
        applied: &[u8],
    ) {
        let learned: Vec<(String, PathBuf)> = plan
            .slots
            .iter()
            .filter(|planned| applied.contains(&planned.slot))
            .filter_map(|planned| {
                let source = match &planned.action {
                    PlannedAction::Write { source } => Some(simplified(source)),
                    PlannedAction::Move { from_slot } => fingerprint_at(before, *from_slot)
                        .and_then(|fingerprint| self.by_fingerprint.get(fingerprint).cloned()),
                    PlannedAction::Settings | PlannedAction::Delete => None,
                }?;
                Some((fingerprint_at(after, planned.slot)?.to_owned(), source))
            })
            .collect();
        self.by_fingerprint.extend(learned);
    }
}

fn fingerprint_at(card: &CardState, slot: u8) -> Option<&str> {
    card.slots
        .get(usize::from(slot))
        .and_then(|found| found.sample.as_ref())
        .map(|sample| sample.fingerprint.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::{PadEdit, PadSettings, SampleFormat, SampleInfo, Slot, TempoMode};
    use crate::sync::PlannedSlot;
    use tempfile::TempDir;

    fn settings() -> PadSettings {
        PadSettings {
            volume: 127,
            lofi: false,
            looping: false,
            gate: true,
            reverse: false,
            tempo_mode: TempoMode::Off,
            original_tempo: 120.0,
            user_tempo: 120.0,
        }
    }

    fn card_with(samples: &[(u8, &str)]) -> CardState {
        CardState {
            root: PathBuf::from("/card"),
            fingerprint: String::new(),
            slots: (0..crate::card::PAD_COUNT as u8)
                .map(|slot| Slot {
                    slot,
                    settings: settings(),
                    sample: samples
                        .iter()
                        .find(|(at, _)| *at == slot)
                        .map(|(_, fingerprint)| SampleInfo {
                            file_name: crate::card::sample_file_name(slot),
                            path: PathBuf::from("/card").join(crate::card::sample_file_name(slot)),
                            fingerprint: (*fingerprint).to_owned(),
                            format: SampleFormat::Wave,
                            channels: 2,
                            frames: 1_000,
                            size_bytes: 4_512,
                            start_frame: 0,
                            end_frame: 1_000,
                            source_path: None,
                        }),
                })
                .collect(),
        }
    }

    fn planned(slot: u8, action: PlannedAction) -> PlannedSlot {
        PlannedSlot {
            slot,
            action,
            edit: PadEdit {
                settings: settings(),
                start_frame: 0,
                end_frame: 0,
            },
        }
    }

    fn plan(slots: Vec<PlannedSlot>) -> SyncPlan {
        SyncPlan {
            card_fingerprint: String::new(),
            slots,
        }
    }

    fn source_at(card: &CardState, slot: usize) -> Option<&Path> {
        card.slots[slot]
            .sample
            .as_ref()
            .and_then(|sample| sample.source_path.as_deref())
    }

    #[test]
    fn a_written_sample_is_known_by_the_file_it_came_from() {
        let mut sources = CardSources::default();
        let kick = PathBuf::from("/samples/kick.wav");
        let written = plan(vec![planned(
            3,
            PlannedAction::Write {
                source: kick.clone(),
            },
        )]);
        let mut after = card_with(&[(3, "fp-kick")]);

        sources.learn_from_sync(&card_with(&[]), &after, &written, &[3]);
        sources.attach_to(&mut after);

        assert_eq!(source_at(&after, 3), Some(kick.as_path()));
    }

    #[test]
    fn a_move_carries_the_source_to_the_sample_at_its_new_pad() {
        let mut sources = CardSources::default();
        sources
            .by_fingerprint
            .insert("fp-kick-at-a1".into(), PathBuf::from("/samples/kick.wav"));
        sources
            .by_fingerprint
            .insert("fp-snare-at-a2".into(), PathBuf::from("/samples/snare.wav"));
        let swapped = plan(vec![
            planned(0, PlannedAction::Move { from_slot: 1 }),
            planned(1, PlannedAction::Move { from_slot: 0 }),
        ]);
        let before = card_with(&[(0, "fp-kick-at-a1"), (1, "fp-snare-at-a2")]);
        let mut after = card_with(&[(0, "fp-snare-at-a1"), (1, "fp-kick-at-a2")]);

        sources.learn_from_sync(&before, &after, &swapped, &[0, 1]);
        sources.attach_to(&mut after);

        assert_eq!(source_at(&after, 0), Some(Path::new("/samples/snare.wav")));
        assert_eq!(source_at(&after, 1), Some(Path::new("/samples/kick.wav")));
    }

    #[test]
    fn a_slot_the_sync_did_not_reach_learns_nothing() {
        let mut sources = CardSources::default();
        let written = plan(vec![planned(
            3,
            PlannedAction::Write {
                source: PathBuf::from("/samples/kick.wav"),
            },
        )]);

        sources.learn_from_sync(&card_with(&[]), &card_with(&[(3, "fp-old")]), &written, &[]);

        assert_eq!(sources, CardSources::default());
    }

    #[test]
    fn a_sample_recorded_on_the_device_has_no_source() {
        let sources = CardSources::default();
        let mut card = card_with(&[(8, "fp-recorded")]);

        sources.attach_to(&mut card);

        assert_eq!(source_at(&card, 8), None);
    }

    #[test]
    fn what_was_learned_survives_a_restart_and_a_missing_file_is_simply_empty() {
        let dir = TempDir::new().expect("temp dir");
        let app_data = dir.path().join("data");
        assert_eq!(CardSources::load(&app_data), CardSources::default());

        let mut sources = CardSources::default();
        sources
            .by_fingerprint
            .insert("fp-kick".into(), PathBuf::from("/samples/kick.wav"));
        sources.save(&app_data).expect("save");

        assert_eq!(CardSources::load(&app_data), sources);
    }
}
