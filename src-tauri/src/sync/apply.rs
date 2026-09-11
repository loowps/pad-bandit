use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::audio::encode;
use crate::card::{
    self, BYTES_PER_PAD, LoadedCard, PAD_COUNT, PAD_INFO_FILE_NAME, PadEdit, PadRecord,
    emptied_record, recorded_record, sample_file_name,
};
use crate::error::{Error, Result};
use crate::paths::Scopes;
use crate::sync::{PlannedAction, PlannedSlot, SyncPlan};

const BACKUPS_DIRECTORY: &str = "card-backups";
const TEMPORARY_SUFFIX: &str = "padbandit-tmp";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Moving,
    Deleting,
    Converting,
    Verifying,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub slot: Option<u8>,
    pub phase: Phase,
    pub slots_done: usize,
    pub slots_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotFailure {
    pub slot: u8,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub applied: Vec<u8>,
    pub skipped: Vec<u8>,
    pub failures: Vec<SlotFailure>,
    pub cancelled: bool,
    pub verified: bool,
}

#[derive(Debug, Default)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    pub fn handle(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.0)
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn reset(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn cancelled(flag: &Option<Arc<AtomicBool>>) -> bool {
    flag.as_ref().is_some_and(|it| it.load(Ordering::SeqCst))
}

pub struct Apply<'a> {
    pub scopes: &'a Scopes,
    pub card: &'a LoadedCard,
    pub app_data: &'a Path,
    pub cancel: Option<Arc<AtomicBool>>,
    pub report: &'a mut dyn FnMut(Progress),
}

pub fn apply_plan(context: &mut Apply<'_>, plan: &SyncPlan) -> Result<SyncOutcome> {
    if let Some(planned) = plan
        .slots
        .iter()
        .find(|planned| usize::from(planned.slot) >= PAD_COUNT)
    {
        return Err(Error::UnknownSlot { slot: planned.slot });
    }
    if let Some(&(slot, from_slot)) = crate::sync::unpaired_moves(plan).first() {
        return Err(Error::UnpairedMove { slot, from_slot });
    }

    let card_root = context.card.root().to_path_buf();
    let samples = card::sample_directory(&card_root);
    context.scopes.writable(&samples)?;

    back_up_pad_info(context.card, context.app_data)?;
    remove_disposable_leftovers(&samples);
    let mut table = PadTable::open(context.scopes, context.card, &samples)?;

    let bytes_total: u64 = plan
        .slots
        .iter()
        .filter_map(|planned| match &planned.action {
            PlannedAction::Write { source } => {
                encode::estimate(source).ok().map(|sample| sample.bytes)
            }
            _ => None,
        })
        .sum();

    let mut outcome = SyncOutcome {
        applied: Vec::new(),
        skipped: Vec::new(),
        failures: Vec::new(),
        cancelled: false,
        verified: false,
    };
    let mut state = Walk {
        slots_total: plan.slots.len(),
        slots_done: 0,
        bytes_done: 0,
        bytes_total,
    };

    let (moves, rest): (Vec<&PlannedSlot>, Vec<&PlannedSlot>) = plan
        .slots
        .iter()
        .partition(|planned| matches!(planned.action, PlannedAction::Move { .. }));

    rename_moved_samples(
        context,
        &samples,
        &moves,
        &mut table,
        &mut state,
        &mut outcome,
    )?;

    for planned in rest {
        if cancelled(&context.cancel) {
            outcome.cancelled = true;
            outcome.skipped.push(planned.slot);
            continue;
        }
        if outcome.cancelled {
            outcome.skipped.push(planned.slot);
            continue;
        }

        let done = match &planned.action {
            PlannedAction::Settings => settings_only(context.card, planned, &mut table),
            PlannedAction::Delete => delete_sample(&samples, planned, context.card, &mut table),
            PlannedAction::Write { source } => {
                write_sample(context, &samples, planned, source, &mut table, &mut state)
            }
            PlannedAction::Move { .. } => Ok(()),
        };

        state.slots_done += 1;
        match done {
            Ok(()) => outcome.applied.push(planned.slot),
            Err(error) => outcome.failures.push(SlotFailure {
                slot: planned.slot,
                reason: error.to_string(),
            }),
        }
        (context.report)(state.at(Some(planned.slot), Phase::Converting));
    }

    (context.report)(state.at(None, Phase::Verifying));
    outcome.verified = verify(context.scopes, &card_root, &table)?;

    Ok(outcome)
}

struct Walk {
    slots_total: usize,
    slots_done: usize,
    bytes_done: u64,
    bytes_total: u64,
}

impl Walk {
    fn at(&self, slot: Option<u8>, phase: Phase) -> Progress {
        Progress {
            slot,
            phase,
            slots_done: self.slots_done,
            slots_total: self.slots_total,
            bytes_done: self.bytes_done,
            bytes_total: self.bytes_total,
        }
    }
}

fn settings_only(card: &LoadedCard, planned: &PlannedSlot, table: &mut PadTable) -> Result<()> {
    let base = record_at(card, planned.slot)?;
    table.write(planned.slot, card::edited_record(&base, &planned.edit))
}

fn delete_sample(
    samples: &Path,
    planned: &PlannedSlot,
    card: &LoadedCard,
    table: &mut PadTable,
) -> Result<()> {
    let base = record_at(card, planned.slot)?;
    table.write(planned.slot, emptied_record(&base))?;
    for name in sample_names(card, planned.slot) {
        let path = samples.join(&name);
        if path.is_file() {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn write_sample(
    context: &mut Apply<'_>,
    samples: &Path,
    planned: &PlannedSlot,
    source: &Path,
    table: &mut PadTable,
    state: &mut Walk,
) -> Result<()> {
    let readable = context.scopes.readable(source)?;
    let destination_name = sample_file_name(planned.slot);
    let destination = samples.join(&destination_name);
    let temporary = destination.with_extension(TEMPORARY_SUFFIX);
    context.scopes.writable(&destination)?;

    (context.report)(state.at(Some(planned.slot), Phase::Converting));

    let written = match encode::encode_to_card(&readable, &temporary, planned.slot) {
        Ok(written) => written,
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
    };
    if let Err(error) = std::fs::rename(&temporary, &destination) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error.into());
    }

    state.bytes_done += written.bytes;
    table.write(
        planned.slot,
        recorded_record(
            written.channels as u8,
            written.bytes,
            &edit_at_card_rate(&planned.edit, &written),
        ),
    )?;

    for name in sample_names(context.card, planned.slot) {
        let stale = samples.join(&name);
        if !name.eq_ignore_ascii_case(&destination_name) && stale.is_file() {
            std::fs::remove_file(&stale)?;
        }
    }
    Ok(())
}

fn edit_at_card_rate(edit: &PadEdit, written: &encode::CardSample) -> PadEdit {
    let end_frame = match edit.end_frame {
        encode::UNTRIMMED_END => written.frames,
        frames => encode::resampled_frames(frames, written.source_rate),
    };
    PadEdit {
        start_frame: encode::resampled_frames(edit.start_frame, written.source_rate),
        end_frame,
        ..*edit
    }
}

fn rename_moved_samples(
    context: &mut Apply<'_>,
    samples: &Path,
    moves: &[&PlannedSlot],
    table: &mut PadTable,
    state: &mut Walk,
    outcome: &mut SyncOutcome,
) -> Result<()> {
    if moves.is_empty() {
        return Ok(());
    }
    (context.report)(state.at(None, Phase::Moving));

    let mut shuffle = Shuffle::default();
    let mut records = BTreeMap::new();
    if let Err(error) = shuffle.run(context, samples, moves, &mut records, state, outcome) {
        shuffle.roll_back();
        return Err(error);
    }
    if let Err(error) = records
        .iter()
        .try_for_each(|(&slot, &record)| table.write(slot, record))
    {
        table.restore(context.card, records.keys().copied());
        shuffle.roll_back();
        return Err(error);
    }

    shuffle.finish();
    (context.report)(state.at(None, Phase::Deleting));
    Ok(())
}

struct Parked {
    park: PathBuf,
    original: PathBuf,
}

impl Parked {
    fn park(original: PathBuf, park: PathBuf) -> Result<Self> {
        std::fs::rename(&original, &park)?;
        Ok(Self { park, original })
    }

    fn put_back(&self) {
        let _ = std::fs::rename(&self.park, &self.original);
    }

    fn current_name(&self) -> &str {
        self.original
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
    }
}

struct Placed {
    destination: PathBuf,
    from_slot: u8,
    parked: Parked,
}

impl Placed {
    fn place(&self, scopes: &Scopes, slot: u8) -> Result<()> {
        scopes.writable(&self.destination)?;
        std::fs::rename(&self.parked.park, &self.destination)?;
        card::write_sample_index(&self.destination, slot)
    }

    fn unplace(&self) {
        if std::fs::rename(&self.destination, &self.parked.park).is_ok() {
            let _ = card::write_sample_index(&self.parked.park, self.from_slot);
        }
    }
}

#[derive(Default)]
struct Shuffle {
    origins: BTreeMap<u8, Parked>,
    replaced: Vec<Parked>,
    placed: Vec<Placed>,
}

impl Shuffle {
    fn run(
        &mut self,
        context: &mut Apply<'_>,
        samples: &Path,
        moves: &[&PlannedSlot],
        records: &mut BTreeMap<u8, PadRecord>,
        state: &mut Walk,
        outcome: &mut SyncOutcome,
    ) -> Result<()> {
        self.park_origins(context.card, samples, moves)?;
        self.park_replaced(context.card, samples, moves)?;

        for planned in moves {
            let PlannedAction::Move { from_slot } = planned.action else {
                continue;
            };
            let Some(parked) = self.origins.remove(&from_slot) else {
                outcome.failures.push(SlotFailure {
                    slot: planned.slot,
                    reason: format!("nothing left to move from slot {from_slot}"),
                });
                continue;
            };

            let destination = samples.join(card::sample_file_name_keeping_extension(
                planned.slot,
                parked.current_name(),
            ));
            let placed = Placed {
                destination,
                from_slot,
                parked,
            };
            let placing = placed.place(context.scopes, planned.slot);
            self.placed.push(placed);
            placing?;

            let base = record_at(context.card, from_slot)?;
            records.insert(planned.slot, card::edited_record(&base, &planned.edit));

            state.slots_done += 1;
            outcome.applied.push(planned.slot);
            (context.report)(state.at(Some(planned.slot), Phase::Moving));
        }
        Ok(())
    }

    fn park_origins(
        &mut self,
        card: &LoadedCard,
        samples: &Path,
        moves: &[&PlannedSlot],
    ) -> Result<()> {
        for planned in moves {
            let PlannedAction::Move { from_slot } = planned.action else {
                continue;
            };
            if self.origins.contains_key(&from_slot) {
                continue;
            }
            let Some(name) = sample_names(card, from_slot).into_iter().next() else {
                continue;
            };
            let park = samples.join(format!("{from_slot}.{TEMPORARY_SUFFIX}"));
            self.origins
                .insert(from_slot, Parked::park(samples.join(&name), park)?);
        }
        Ok(())
    }

    fn park_replaced(
        &mut self,
        card: &LoadedCard,
        samples: &Path,
        moves: &[&PlannedSlot],
    ) -> Result<()> {
        for planned in moves {
            if self.origins.contains_key(&planned.slot) {
                continue;
            }
            for name in sample_names(card, planned.slot) {
                let original = samples.join(&name);
                if original.is_file() {
                    let park =
                        samples.join(format!("{}.replaced.{TEMPORARY_SUFFIX}", planned.slot));
                    self.replaced.push(Parked::park(original, park)?);
                }
            }
        }
        Ok(())
    }

    fn finish(self) {
        for parked in self.replaced {
            let _ = std::fs::remove_file(parked.park);
        }
    }

    fn roll_back(self) {
        for placed in self.placed.iter().rev() {
            placed.unplace();
        }
        self.placed
            .iter()
            .map(|placed| &placed.parked)
            .chain(self.origins.values())
            .chain(&self.replaced)
            .for_each(Parked::put_back);
    }
}

struct PadTable {
    file: File,
    expected: Vec<u8>,
    written: BTreeMap<u8, PadRecord>,
}

impl PadTable {
    fn open(scopes: &Scopes, card: &LoadedCard, samples: &Path) -> Result<Self> {
        let path = scopes.writable(&samples.join(PAD_INFO_FILE_NAME))?;
        let file = std::fs::OpenOptions::new().write(true).open(path)?;
        Ok(Self {
            file,
            expected: card.pad_info_raw().to_vec(),
            written: BTreeMap::new(),
        })
    }

    fn write(&mut self, slot: u8, record: PadRecord) -> Result<()> {
        let patched = card::patch_pad_records(&self.expected, &BTreeMap::from([(slot, record)]))?;
        let range = record_range(slot);
        self.put(range.start, &patched[range])?;
        self.expected = patched;
        self.written.insert(slot, record);
        Ok(())
    }

    fn restore(&mut self, card: &LoadedCard, slots: impl Iterator<Item = u8>) {
        for slot in slots {
            let range = record_range(slot);
            let _ = self.put(range.start, &card.pad_info_raw()[range]);
        }
    }

    fn put(&mut self, offset: usize, bytes: &[u8]) -> Result<()> {
        self.file.seek(SeekFrom::Start(offset as u64))?;
        self.file.write_all(bytes)?;
        self.file.sync_all()?;
        Ok(())
    }
}

fn record_range(slot: u8) -> Range<usize> {
    let start = usize::from(slot) * BYTES_PER_PAD;
    start..start + BYTES_PER_PAD
}

fn remove_disposable_leftovers(samples: &Path) {
    let Ok(entries) = std::fs::read_dir(samples) else {
        return;
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if is_disposable_leftover(&path) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn is_disposable_leftover(path: &Path) -> bool {
    let is_temporary = path.extension().is_some_and(|it| it == TEMPORARY_SUFFIX);
    let converted_for_a_pad = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(card::slot_from_sample_stem)
        .is_some();
    is_temporary && converted_for_a_pad
}

fn verify(scopes: &Scopes, card_root: &Path, table: &PadTable) -> Result<bool> {
    let reread = card::read_card(scopes, card_root)?;
    let slots = reread.state().slots;
    let table_is_as_written = reread.pad_info_raw() == table.expected.as_slice();
    let files_agree_with_records = table.written.iter().all(|(&slot, record)| {
        let holds_audio = record.original_end > record.original_start;
        slots[usize::from(slot)].sample.is_some() == holds_audio
    });
    Ok(table_is_as_written && files_agree_with_records)
}

fn back_up_pad_info(card: &LoadedCard, app_data: &Path) -> Result<()> {
    let directory = app_data.join(BACKUPS_DIRECTORY);
    std::fs::create_dir_all(&directory)?;

    let path = directory.join(format!("{}.bin", card.state().fingerprint));
    if path.exists() {
        return Ok(());
    }
    std::fs::write(path, card.pad_info_raw())?;
    Ok(())
}

fn record_at(card: &LoadedCard, slot: u8) -> Result<PadRecord> {
    card.records()
        .get(usize::from(slot))
        .copied()
        .ok_or(Error::UnknownSlot { slot })
}

fn sample_names(card: &LoadedCard, slot: u8) -> Vec<String> {
    card.state()
        .slots
        .into_iter()
        .find(|it| it.slot == slot)
        .and_then(|it| it.sample.map(|sample| vec![sample.file_name]))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::testing;
    use crate::card::{PadSettings, TempoMode, read_card};
    use tempfile::TempDir;

    const AIFF_HEADER_FIXTURE: &[u8] =
        include_bytes!("../../tests/fixtures/A0000001.header512.aiff.bin");

    struct Fixture {
        _root: TempDir,
        card_root: PathBuf,
        samples: PathBuf,
        browse: PathBuf,
        app_data: PathBuf,
        scopes: Scopes,
    }

    fn edit() -> crate::card::PadEdit {
        crate::card::PadEdit {
            settings: PadSettings {
                volume: 100,
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

    fn fixture(filled: u8) -> Fixture {
        let root = TempDir::new().expect("temp dir");
        let app_data = root.path().join("data");
        let card_root = root.path().join("card");
        let browse = root.path().join("browse");
        let samples = card::sample_directory(&card_root);
        std::fs::create_dir_all(&samples).expect("card dirs");
        std::fs::create_dir_all(&browse).expect("browse dir");

        let mut table = vec![0u8; PAD_COUNT * 32];
        for slot in 0..usize::from(filled) {
            let at = slot * 32;
            let end = 512u32 + 4_000;
            table[at..at + 4].copy_from_slice(&512u32.to_be_bytes());
            table[at + 4..at + 8].copy_from_slice(&end.to_be_bytes());
            table[at + 8..at + 12].copy_from_slice(&512u32.to_be_bytes());
            table[at + 12..at + 16].copy_from_slice(&end.to_be_bytes());
            table[at + 16] = 127;
            table[at + 19] = 1;
            table[at + 21] = 1;
            table[at + 22] = 2;
            table[at + 24..at + 28].copy_from_slice(&1199u32.to_be_bytes());
            table[at + 28..at + 32].copy_from_slice(&1199u32.to_be_bytes());
        }
        std::fs::write(samples.join(PAD_INFO_FILE_NAME), &table).expect("pad info");
        for slot in 0..filled {
            let path = samples.join(sample_file_name(slot));
            testing::write_silence_wav(&path, 44_100, 1_000, 2);
            let _ = card::write_sample_index(&path, slot);
        }

        let mut scopes = Scopes::new(&app_data).expect("scopes");
        scopes.set_card_root(Some(&card_root)).expect("card root");
        scopes.add_read_root(&browse).expect("browse root");

        Fixture {
            _root: root,
            card_root,
            samples,
            browse,
            app_data,
            scopes,
        }
    }

    impl Fixture {
        fn card(&self) -> LoadedCard {
            read_card(&self.scopes, &self.card_root).expect("read card")
        }

        fn source(&self, name: &str, frames: u32) -> PathBuf {
            self.source_at(name, 44_100, frames)
        }

        fn source_at(&self, name: &str, rate: u32, frames: u32) -> PathBuf {
            let path = self.browse.join(name);
            testing::write_silence_wav(&path, rate, frames, 2);
            path
        }

        fn run(&self, plan: &SyncPlan) -> (SyncOutcome, Vec<Progress>) {
            self.run_with(plan, None)
        }

        fn run_with(
            &self,
            plan: &SyncPlan,
            cancel: Option<Arc<AtomicBool>>,
        ) -> (SyncOutcome, Vec<Progress>) {
            let (outcome, seen) = self.attempt_with(plan, cancel);
            (outcome.expect("apply"), seen)
        }

        fn attempt(&self, plan: &SyncPlan) -> Result<SyncOutcome> {
            self.attempt_with(plan, None).0
        }

        fn attempt_with(
            &self,
            plan: &SyncPlan,
            cancel: Option<Arc<AtomicBool>>,
        ) -> (Result<SyncOutcome>, Vec<Progress>) {
            let mut seen: Vec<Progress> = Vec::new();
            let outcome = self.apply(&self.card(), plan, cancel, &mut |progress| {
                seen.push(progress)
            });
            (outcome, seen)
        }

        fn apply(
            &self,
            card: &LoadedCard,
            plan: &SyncPlan,
            cancel: Option<Arc<AtomicBool>>,
            report: &mut dyn FnMut(Progress),
        ) -> Result<SyncOutcome> {
            let mut context = Apply {
                scopes: &self.scopes,
                card,
                app_data: &self.app_data,
                cancel,
                report,
            };
            apply_plan(&mut context, plan)
        }

        fn verified_after(&self, plan: &SyncPlan, tamper: impl Fn(&Self)) -> bool {
            self.apply(&self.card(), plan, None, &mut |progress| {
                if progress.phase == Phase::Verifying {
                    tamper(self);
                }
            })
            .expect("apply")
            .verified
        }

        fn snapshot(&self) -> BTreeMap<String, Vec<u8>> {
            std::fs::read_dir(&self.samples)
                .expect("samples")
                .filter_map(|entry| entry.ok())
                .map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    (name, std::fs::read(entry.path()).expect("read"))
                })
                .collect()
        }

        fn pad_info(&self) -> Vec<u8> {
            std::fs::read(self.samples.join(PAD_INFO_FILE_NAME)).expect("pad info")
        }

        fn strays(&self) -> usize {
            std::fs::read_dir(&self.samples)
                .expect("samples")
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .contains(TEMPORARY_SUFFIX)
                })
                .count()
        }
    }

    fn plan(slots: Vec<PlannedSlot>) -> SyncPlan {
        SyncPlan {
            card_fingerprint: String::new(),
            slots,
        }
    }

    fn write(slot: u8, source: PathBuf) -> PlannedSlot {
        PlannedSlot {
            slot,
            action: PlannedAction::Write { source },
            edit: edit(),
        }
    }

    fn moved(slot: u8, from_slot: u8) -> PlannedSlot {
        PlannedSlot {
            slot,
            action: PlannedAction::Move { from_slot },
            edit: edit(),
        }
    }

    fn deleted(slot: u8) -> PlannedSlot {
        PlannedSlot {
            slot,
            action: PlannedAction::Delete,
            edit: edit(),
        }
    }

    fn settings(slot: u8) -> PlannedSlot {
        PlannedSlot {
            slot,
            action: PlannedAction::Settings,
            edit: edit(),
        }
    }

    #[test]
    fn a_sync_clears_conversions_an_earlier_sync_left_behind() {
        let f = fixture(2);
        std::fs::write(f.samples.join("A0000006.padbandit-tmp"), b"half a sample").expect("write");

        f.run(&plan(vec![settings(0)]));

        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn a_sync_keeps_set_aside_samples_that_may_be_the_only_copy() {
        let f = fixture(2);
        for name in ["0.padbandit-tmp", "5.replaced.padbandit-tmp"] {
            std::fs::write(f.samples.join(name), b"a user's sample").expect("write");
        }

        f.run(&plan(vec![settings(0)]));

        assert!(f.samples.join("0.padbandit-tmp").exists());
        assert!(f.samples.join("5.replaced.padbandit-tmp").exists());
    }

    #[test]
    fn a_moved_aiff_keeps_its_aif_extension() {
        let f = fixture(2);
        std::fs::write(f.samples.join("A0000003.AIF"), AIFF_HEADER_FIXTURE).expect("aiff");

        let outcome = f.run(&plan(vec![moved(5, 2), deleted(2)])).0;

        assert!(outcome.failures.is_empty());
        let landed = f.samples.join("A0000006.AIF");
        assert_eq!(card::read_sample_index(&landed).expect("index"), 5);
        assert!(!f.samples.join(sample_file_name(5)).exists());
        assert!(!f.samples.join("A0000003.AIF").exists());
        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn a_move_onto_a_pad_holding_an_aiff_leaves_that_pad_one_file() {
        let f = fixture(2);
        std::fs::write(f.samples.join("A0000003.AIF"), AIFF_HEADER_FIXTURE).expect("aiff");

        let outcome = f.run(&plan(vec![moved(2, 0), deleted(0)])).0;

        assert!(outcome.failures.is_empty());
        assert!(f.samples.join(sample_file_name(2)).exists());
        assert!(!f.samples.join("A0000003.AIF").exists());
        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn a_move_that_fails_halfway_puts_every_file_back_and_leaves_pad_info_alone() {
        let f = fixture(2);
        std::fs::write(f.samples.join(sample_file_name(1)), b"not a card sample").expect("write");
        let before = f.snapshot();

        f.attempt(&plan(vec![moved(0, 1), moved(1, 0)]))
            .expect_err("the second file has no header to patch");

        assert_eq!(f.snapshot(), before);
    }

    #[test]
    fn a_pad_table_that_cannot_be_opened_for_writing_is_refused_before_any_sample_changes() {
        let f = fixture(2);
        let source = f.source("kick.wav", 800);
        let card = f.card();
        let table = f.samples.join(PAD_INFO_FILE_NAME);
        std::fs::remove_file(&table).expect("remove the table");
        std::fs::create_dir(&table).expect("block the table");

        f.apply(
            &card,
            &plan(vec![write(5, source), deleted(1)]),
            None,
            &mut |_| {},
        )
        .expect_err("the table cannot be opened");

        assert_eq!(wav_files(&f.samples), 2);
        assert!(f.samples.join(sample_file_name(1)).exists());
        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn each_slot_is_recorded_on_the_card_before_the_next_one_starts() {
        let f = fixture(2);
        let sync = plan(vec![
            write(5, f.source("kick.wav", 800)),
            write(6, f.source("snare.wav", 800)),
        ]);
        let mut mid_sync = None;

        f.apply(&f.card(), &sync, None, &mut |progress| {
            if progress.slot == Some(6) && progress.slots_done == 1 {
                let card = read_card(&f.scopes, &f.card_root).expect("read mid-sync");
                mid_sync = Some((card.records()[5], card.state().slots[5].sample.is_some()));
            }
        })
        .expect("apply");

        let (record, has_file) = mid_sync.expect("the second slot started");
        assert_eq!(record.original_end, 512 + 800 * 4);
        assert!(has_file);
    }

    #[test]
    fn a_pad_whose_file_is_named_in_lower_case_keeps_its_new_sample() {
        let f = fixture(2);
        std::fs::rename(
            f.samples.join(sample_file_name(1)),
            f.samples.join("a0000002.wav"),
        )
        .expect("rename");

        let outcome = f.run(&plan(vec![write(1, f.source("kick.wav", 800))])).0;

        assert!(outcome.failures.is_empty());
        assert!(outcome.verified);
        let landed = std::fs::read(f.samples.join(sample_file_name(1))).expect("read");
        assert_eq!(landed.len(), 512 + 800 * 4);
    }

    #[test]
    fn verification_fails_when_an_untouched_record_differs_from_what_was_written() {
        let f = fixture(2);

        let verified = f.verified_after(&plan(vec![write(5, f.source("kick.wav", 800))]), |f| {
            let mut table = f.pad_info();
            table[100 * 32 + 16] ^= 1;
            std::fs::write(f.samples.join(PAD_INFO_FILE_NAME), table).expect("tamper");
        });

        assert!(!verified);
    }

    #[test]
    fn verification_fails_when_a_recorded_sample_is_missing() {
        let f = fixture(2);

        let verified = f.verified_after(&plan(vec![write(5, f.source("kick.wav", 800))]), |f| {
            std::fs::remove_file(f.samples.join(sample_file_name(5))).expect("remove");
        });

        assert!(!verified);
    }

    #[test]
    fn a_slot_outside_the_card_is_refused_before_anything_on_the_card_is_touched() {
        let f = fixture(2);
        let source = f.source("kick.wav", 800);
        let before = f.snapshot();

        let refusal = f
            .attempt(&plan(vec![write(200, source)]))
            .expect_err("refused");

        assert!(matches!(refusal, Error::UnknownSlot { slot: 200 }));
        assert_eq!(f.snapshot(), before);
        assert!(!f.app_data.join(BACKUPS_DIRECTORY).exists());
    }

    #[test]
    fn a_written_sample_lands_in_card_format_with_its_own_slot_index() {
        let f = fixture(2);
        let outcome = f.run(&plan(vec![write(5, f.source("kick.wav", 800))])).0;

        assert_eq!(outcome.applied, vec![5]);
        assert!(outcome.failures.is_empty());

        let landed = f.samples.join(sample_file_name(5));
        let bytes = std::fs::read(&landed).expect("read");
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[504..508], b"data");
        assert_eq!(bytes.len(), 512 + 800 * 4);
        assert_eq!(card::read_sample_index(&landed).expect("index"), 5);
    }

    #[test]
    fn a_region_trimmed_on_a_source_at_another_rate_lands_at_the_same_moment_on_the_card() {
        let f = fixture(2);
        let source = f.source_at("kick.wav", 48_000, 48_000);
        let trimmed = PlannedSlot {
            edit: crate::card::PadEdit {
                start_frame: 12_000,
                end_frame: 36_000,
                ..edit()
            },
            ..write(5, source)
        };

        f.run(&plan(vec![trimmed]));

        let record = f.card().records()[5];
        let block_align = 4;
        assert_eq!(record.user_start, 512 + 11_025 * block_align);
        assert_eq!(record.user_end, 512 + 33_075 * block_align);
    }

    #[test]
    fn a_sample_whose_waveform_was_never_opened_plays_whole_rather_than_silent() {
        let f = fixture(2);

        f.run(&plan(vec![write(
            5,
            f.source_at("kick.wav", 48_000, 48_000),
        )]));

        let record = f.card().records()[5];
        assert_eq!(record.user_start, 512);
        assert_eq!(record.user_end, record.original_end);
        assert!(record.user_end > record.user_start);
    }

    #[test]
    fn a_region_on_a_source_already_at_the_cards_rate_is_written_through_unchanged() {
        let f = fixture(2);
        let source = f.source("kick.wav", 44_100);
        let trimmed = PlannedSlot {
            edit: crate::card::PadEdit {
                start_frame: 12_000,
                end_frame: 36_000,
                ..edit()
            },
            ..write(5, source)
        };

        f.run(&plan(vec![trimmed]));

        let record = f.card().records()[5];
        assert_eq!(record.user_start, 512 + 12_000 * 4);
        assert_eq!(record.user_end, 512 + 36_000 * 4);
    }

    #[test]
    fn writing_one_pad_leaves_every_other_record_byte_identical() {
        let f = fixture(2);
        let before = f.pad_info();

        f.run(&plan(vec![write(5, f.source("kick.wav", 800))]));

        let after = f.pad_info();
        assert_eq!(before[..5 * 32], after[..5 * 32]);
        assert_eq!(before[6 * 32..], after[6 * 32..]);
        assert_ne!(before[5 * 32..6 * 32], after[5 * 32..6 * 32]);
    }

    #[test]
    fn the_source_file_is_never_touched() {
        let f = fixture(2);
        let source = f.source("kick.wav", 800);
        let before = std::fs::read(&source).expect("read source");

        f.run(&plan(vec![write(5, source.clone())]));

        assert_eq!(std::fs::read(&source).expect("read source"), before);
    }

    #[test]
    fn the_original_pad_info_is_backed_up_into_app_data_not_onto_the_card() {
        let f = fixture(2);
        let before = f.pad_info();

        f.run(&plan(vec![write(5, f.source("kick.wav", 800))]));

        let backups: Vec<PathBuf> = std::fs::read_dir(f.app_data.join(BACKUPS_DIRECTORY))
            .expect("backups")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(std::fs::read(&backups[0]).expect("backup"), before);
        assert_eq!(f.strays(), 0, "no temporary files left on the card");
    }

    #[test]
    fn deleting_a_pad_removes_its_file_and_collapses_its_region() {
        let f = fixture(2);
        let outcome = f
            .run(&plan(vec![PlannedSlot {
                slot: 1,
                action: PlannedAction::Delete,
                edit: edit(),
            }]))
            .0;

        assert_eq!(outcome.applied, vec![1]);
        assert!(!f.samples.join(sample_file_name(1)).exists());

        let record = f.card().records()[1];
        assert_eq!(record.original_start, record.original_end);
        assert_eq!(record.original_end, 512);
        assert_eq!(record.original_tempo, card::DEFAULT_TEMPO);
    }

    #[test]
    fn a_swap_renames_both_files_and_patches_each_index() {
        let f = fixture(2);
        let first = std::fs::read(f.samples.join(sample_file_name(0))).expect("read");

        let outcome = f.run(&plan(vec![moved(0, 1), moved(1, 0)])).0;

        assert!(outcome.failures.is_empty());
        assert_eq!(
            card::read_sample_index(&f.samples.join(sample_file_name(0))).expect("index"),
            0
        );
        assert_eq!(
            card::read_sample_index(&f.samples.join(sample_file_name(1))).expect("index"),
            1
        );

        let now_at_one = std::fs::read(f.samples.join(sample_file_name(1))).expect("read");
        assert_eq!(now_at_one.len(), first.len());
        assert_eq!(
            now_at_one[512..],
            first[512..],
            "the audio itself is untouched"
        );
        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn half_of_a_swap_is_refused_before_anything_on_the_card_is_touched() {
        let f = fixture(2);
        let files_before = wav_files(&f.samples);
        let pad_info_before = f.pad_info();
        let card = f.card();
        let mut report = |_: Progress| {};
        let mut context = Apply {
            scopes: &f.scopes,
            card: &card,
            app_data: &f.app_data,
            cancel: None,
            report: &mut report,
        };

        let refusal = apply_plan(&mut context, &plan(vec![moved(0, 1)])).expect_err("refused");

        assert!(matches!(
            refusal,
            Error::UnpairedMove {
                slot: 0,
                from_slot: 1
            }
        ));
        assert_eq!(wav_files(&f.samples), files_before);
        assert_eq!(f.pad_info(), pad_info_before);
        assert!(!f.app_data.join(BACKUPS_DIRECTORY).exists());
    }

    #[test]
    fn a_move_whose_origin_takes_a_new_sample_keeps_both() {
        let f = fixture(2);

        let outcome = f
            .run(&plan(vec![
                moved(5, 0),
                write(0, f.source("kick.wav", 800)),
            ]))
            .0;

        assert!(outcome.failures.is_empty());
        assert_eq!(wav_files(&f.samples), 3);
        assert_eq!(f.card().records()[5].original_end, 512 + 4_000);
        assert_eq!(f.strays(), 0);
    }

    fn wav_files(samples: &Path) -> usize {
        std::fs::read_dir(samples)
            .expect("samples")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".WAV"))
            .count()
    }

    #[test]
    fn emptying_a_slot_a_sample_already_left_still_collapses_its_region() {
        let f = fixture(2);

        let outcome = f
            .run(&plan(vec![
                moved(5, 0),
                PlannedSlot {
                    slot: 0,
                    action: PlannedAction::Delete,
                    edit: edit(),
                },
            ]))
            .0;

        assert!(outcome.failures.is_empty());
        assert!(f.samples.join(sample_file_name(5)).exists());
        assert!(!f.samples.join(sample_file_name(0)).exists());

        let record = f.card().records()[0];
        assert_eq!(record.original_start, record.original_end);
        assert_eq!(f.card().records()[5].original_end, 512 + 4_000);
        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn a_settings_only_change_writes_a_record_and_no_file() {
        let f = fixture(2);
        let before = std::fs::read(f.samples.join(sample_file_name(0))).expect("read");

        let outcome = f
            .run(&plan(vec![PlannedSlot {
                slot: 0,
                action: PlannedAction::Settings,
                edit: edit(),
            }]))
            .0;

        assert_eq!(outcome.applied, vec![0]);
        assert_eq!(
            std::fs::read(f.samples.join(sample_file_name(0))).expect("read"),
            before
        );
        assert_eq!(f.card().records()[0].volume, 100);
    }

    #[test]
    fn every_applied_slot_verifies_against_what_was_asked_for() {
        let f = fixture(2);

        let outcome = f
            .run(&plan(vec![
                write(5, f.source("kick.wav", 800)),
                PlannedSlot {
                    slot: 1,
                    action: PlannedAction::Delete,
                    edit: edit(),
                },
            ]))
            .0;

        assert!(outcome.verified);
        assert!(!outcome.cancelled);
    }

    #[test]
    fn cancelling_skips_the_rest_but_leaves_the_card_consistent() {
        let f = fixture(2);
        let cancel = Arc::new(AtomicBool::new(true));

        let outcome = f
            .run_with(
                &plan(vec![
                    write(5, f.source("kick.wav", 800)),
                    write(6, f.source("snare.wav", 800)),
                ]),
                Some(cancel),
            )
            .0;

        assert!(outcome.cancelled);
        assert!(outcome.applied.is_empty());
        assert_eq!(outcome.skipped, vec![5, 6]);
        assert!(!f.samples.join(sample_file_name(5)).exists());
        assert_eq!(f.pad_info().len(), PAD_COUNT * 32);
        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn a_source_that_cannot_be_read_fails_its_slot_and_leaves_no_debris() {
        let f = fixture(2);
        let broken = f.browse.join("broken.wav");
        std::fs::write(&broken, b"not audio at all").expect("write");

        let outcome = f.run(&plan(vec![write(5, broken)])).0;

        assert!(outcome.applied.is_empty());
        assert_eq!(outcome.failures.len(), 1);
        assert_eq!(outcome.failures[0].slot, 5);
        assert!(!f.samples.join(sample_file_name(5)).exists());
        assert_eq!(f.strays(), 0);
    }

    #[test]
    fn a_source_outside_every_read_root_is_refused() {
        let f = fixture(2);
        let outside = f._root.path().join("elsewhere.wav");
        testing::write_silence_wav(&outside, 44_100, 100, 2);

        let outcome = f.run(&plan(vec![write(5, outside)])).0;

        assert_eq!(outcome.failures.len(), 1);
        assert!(!f.samples.join(sample_file_name(5)).exists());
    }

    #[test]
    fn progress_counts_bytes_and_names_the_pad_being_worked_on() {
        let f = fixture(2);

        let (_, seen) = f.run(&plan(vec![write(5, f.source("kick.wav", 800))]));

        let last = seen.last().expect("progress");
        assert_eq!(last.phase, Phase::Verifying);
        assert_eq!(last.bytes_total, 512 + 800 * 4);
        assert_eq!(last.bytes_done, last.bytes_total);
        assert!(seen.iter().any(|it| it.slot == Some(5)));
    }
}
