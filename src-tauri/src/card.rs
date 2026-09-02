use std::collections::BTreeMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::paths::Scopes;

pub const CARD_SEGMENTS: [&str; 3] = ["ROLAND", "SP-404SX", "SMPL"];
pub const PAD_INFO_FILE_NAME: &str = "PAD_INFO.BIN";

pub const PAD_COUNT: usize = 120;
pub const PADS_PER_BANK: usize = 12;
pub const BYTES_PER_PAD: usize = 32;
pub const PAD_INFO_BYTE_LENGTH: usize = PAD_COUNT * BYTES_PER_PAD;

pub const AUDIO_DATA_OFFSET: u32 = 512;
const BYTES_PER_SAMPLE: u32 = 2;
const TEMPO_SCALE: f32 = 10.0;

const BANK_LETTERS: [char; 10] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const SAMPLE_EXTENSIONS: [&str; 3] = ["WAV", "AIF", "AIFF"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PadRecord {
    pub original_start: u32,
    pub original_end: u32,
    pub user_start: u32,
    pub user_end: u32,
    pub volume: u8,
    pub lofi: u8,
    pub looping: u8,
    pub gate: u8,
    pub reverse: u8,
    pub format: u8,
    pub channels: u8,
    pub tempo_mode: u8,
    pub original_tempo: u32,
    pub user_tempo: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SampleFormat {
    Wave,
    Aiff,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TempoMode {
    Off,
    Pattern,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PadSettings {
    pub volume: u8,
    pub lofi: bool,
    #[serde(rename = "loop")]
    pub looping: bool,
    pub gate: bool,
    pub reverse: bool,
    pub tempo_mode: TempoMode,
    pub original_tempo: f32,
    pub user_tempo: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleInfo {
    pub file_name: String,
    pub path: PathBuf,
    pub fingerprint: String,
    pub format: SampleFormat,
    pub channels: u8,
    pub frames: u64,
    pub size_bytes: u64,
    pub start_frame: u64,
    pub end_frame: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub slot: u8,
    pub settings: PadSettings,
    pub sample: Option<SampleInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardState {
    pub root: PathBuf,
    pub fingerprint: String,
    pub slots: Vec<Slot>,
}

#[derive(Debug, Clone)]
struct SampleFile {
    name: String,
    path: PathBuf,
    size: u64,
    fingerprint: String,
}

pub struct LoadedCard {
    root: PathBuf,
    pad_info_raw: Vec<u8>,
    records: [PadRecord; PAD_COUNT],
    samples: Vec<Option<SampleFile>>,
}

impl LoadedCard {
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn pad_info_raw(&self) -> &[u8] {
        &self.pad_info_raw
    }

    pub fn records(&self) -> &[PadRecord; PAD_COUNT] {
        &self.records
    }

    pub fn state(&self) -> CardState {
        let slots: Vec<Slot> = (0..PAD_COUNT).map(|slot| self.slot(slot)).collect();
        CardState {
            root: self.root.clone(),
            fingerprint: fingerprint_of(&self.pad_info_raw, &slots),
            slots,
        }
    }

    fn slot(&self, slot: usize) -> Slot {
        let record = self.records[slot];
        Slot {
            slot: slot as u8,
            settings: settings_of(&record),
            sample: self.samples[slot]
                .as_ref()
                .map(|file| sample_info(&record, file)),
        }
    }
}

fn fingerprint_of(pad_info_raw: &[u8], slots: &[Slot]) -> String {
    let mut hasher = DefaultHasher::new();
    pad_info_raw.hash(&mut hasher);
    for slot in slots {
        slot.slot.hash(&mut hasher);
        match &slot.sample {
            Some(sample) => (&sample.file_name, &sample.fingerprint).hash(&mut hasher),
            None => "empty".hash(&mut hasher),
        }
    }
    format!("{:016x}", hasher.finish())
}

pub fn sample_directory(card_root: &Path) -> PathBuf {
    CARD_SEGMENTS
        .iter()
        .fold(card_root.to_path_buf(), |path, segment| path.join(segment))
}

pub fn sample_file_name(slot: u8) -> String {
    let bank = BANK_LETTERS[slot as usize / PADS_PER_BANK];
    let number = slot as usize % PADS_PER_BANK + 1;
    format!("{bank}{number:07}.WAV")
}

pub fn slot_from_sample_file_name(file_name: &str) -> Option<u8> {
    let (stem, extension) = file_name.rsplit_once('.')?;
    if !SAMPLE_EXTENSIONS.contains(&extension.to_uppercase().as_str()) {
        return None;
    }

    let mut characters = stem.chars();
    let bank = characters.next()?.to_ascii_uppercase();
    let digits = characters.as_str();
    if digits.len() != 7 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    let bank_index = BANK_LETTERS.iter().position(|&letter| letter == bank)?;
    let number: usize = digits.parse().ok()?;
    if number == 0 || number > PADS_PER_BANK {
        return None;
    }

    Some((bank_index * PADS_PER_BANK + number - 1) as u8)
}

pub fn decode_pad_info(bytes: &[u8]) -> Result<[PadRecord; PAD_COUNT]> {
    if bytes.len() < PAD_INFO_BYTE_LENGTH {
        return Err(Error::PadInfoTooShort {
            expected: PAD_INFO_BYTE_LENGTH,
            actual: bytes.len(),
        });
    }

    Ok(std::array::from_fn(|slot| {
        decode_record(&bytes[slot * BYTES_PER_PAD..(slot + 1) * BYTES_PER_PAD])
    }))
}

fn decode_record(bytes: &[u8]) -> PadRecord {
    PadRecord {
        original_start: big_endian_u32(bytes, 0),
        original_end: big_endian_u32(bytes, 4),
        user_start: big_endian_u32(bytes, 8),
        user_end: big_endian_u32(bytes, 12),
        volume: bytes[16],
        lofi: bytes[17],
        looping: bytes[18],
        gate: bytes[19],
        reverse: bytes[20],
        format: bytes[21],
        channels: bytes[22],
        tempo_mode: bytes[23],
        original_tempo: big_endian_u32(bytes, 24),
        user_tempo: big_endian_u32(bytes, 28),
    }
}

fn big_endian_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn settings_of(record: &PadRecord) -> PadSettings {
    PadSettings {
        volume: record.volume,
        lofi: record.lofi != 0,
        looping: record.looping != 0,
        gate: record.gate != 0,
        reverse: record.reverse != 0,
        tempo_mode: match record.tempo_mode {
            1 => TempoMode::Pattern,
            2 => TempoMode::User,
            _ => TempoMode::Off,
        },
        original_tempo: record.original_tempo as f32 / TEMPO_SCALE,
        user_tempo: record.user_tempo as f32 / TEMPO_SCALE,
    }
}

fn sample_info(record: &PadRecord, file: &SampleFile) -> SampleInfo {
    let block_align = block_align(record.channels);
    SampleInfo {
        file_name: file.name.clone(),
        path: file.path.clone(),
        fingerprint: file.fingerprint.clone(),
        format: match record.format {
            0 => SampleFormat::Aiff,
            1 => SampleFormat::Wave,
            _ => SampleFormat::Unknown,
        },
        channels: record.channels,
        frames: frames_in_file(file.size, block_align),
        size_bytes: file.size,
        start_frame: byte_offset_to_frame(record.user_start, block_align),
        end_frame: byte_offset_to_frame(record.user_end, block_align),
    }
}

fn block_align(channels: u8) -> u32 {
    u32::from(channels.max(1)) * BYTES_PER_SAMPLE
}

pub fn byte_offset_to_frame(byte_offset: u32, block_align: u32) -> u64 {
    u64::from(byte_offset.saturating_sub(AUDIO_DATA_OFFSET)) / u64::from(block_align)
}

pub fn frame_to_byte_offset(frame: u64, block_align: u32) -> u64 {
    u64::from(AUDIO_DATA_OFFSET).saturating_add(frame.saturating_mul(u64::from(block_align)))
}

fn frames_in_file(size_bytes: u64, block_align: u32) -> u64 {
    size_bytes.saturating_sub(u64::from(AUDIO_DATA_OFFSET)) / u64::from(block_align)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PadEdit {
    pub settings: PadSettings,
    pub start_frame: u64,
    pub end_frame: u64,
}

pub fn edited_record(base: &PadRecord, edit: &PadEdit) -> PadRecord {
    let block_align = block_align(base.channels);
    let settings = edit.settings;
    let (user_start, user_end) = region_within(base, edit, block_align);

    PadRecord {
        user_start,
        user_end,
        volume: settings.volume.min(MAX_VOLUME),
        lofi: u8::from(settings.lofi),
        looping: u8::from(settings.looping),
        gate: u8::from(settings.gate),
        reverse: u8::from(settings.reverse),
        tempo_mode: match settings.tempo_mode {
            TempoMode::Off => 0,
            TempoMode::Pattern => 1,
            TempoMode::User => 2,
        },
        original_tempo: stored_tempo(settings.original_tempo),
        user_tempo: stored_tempo(settings.user_tempo),
        ..*base
    }
}

pub const MAX_VOLUME: u8 = 127;
pub const DEFAULT_TEMPO: u32 = 1200;
pub const WAVE_SAMPLE_INDEX_OFFSET: u64 = 58;
pub const AIFF_SAMPLE_INDEX_OFFSET: u64 = 62;

pub fn write_sample_index(path: &Path, slot: u8) -> Result<()> {
    use std::io::Write;

    let mut file = std::fs::OpenOptions::new().read(true).write(true).open(path)?;
    let mut form = [0u8; 4];
    file.read_exact(&mut form)?;

    let (offset, bytes) = match &form {
        b"RIFF" => (WAVE_SAMPLE_INDEX_OFFSET, u32::from(slot).to_le_bytes()),
        b"FORM" => (AIFF_SAMPLE_INDEX_OFFSET, u32::from(slot).to_be_bytes()),
        _ => return Err(Error::NotACard { path: path.to_path_buf() }),
    };

    file.seek(SeekFrom::Start(offset))?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

pub fn read_sample_index(path: &Path) -> Result<u32> {
    let mut file = std::fs::File::open(path)?;
    let mut form = [0u8; 4];
    file.read_exact(&mut form)?;

    let mut bytes = [0u8; 4];
    match &form {
        b"RIFF" => {
            file.seek(SeekFrom::Start(WAVE_SAMPLE_INDEX_OFFSET))?;
            file.read_exact(&mut bytes)?;
            Ok(u32::from_le_bytes(bytes))
        }
        b"FORM" => {
            file.seek(SeekFrom::Start(AIFF_SAMPLE_INDEX_OFFSET))?;
            file.read_exact(&mut bytes)?;
            Ok(u32::from_be_bytes(bytes))
        }
        _ => Err(Error::NotACard { path: path.to_path_buf() }),
    }
}

pub fn recorded_record(channels: u8, bytes: u64, edit: &PadEdit) -> PadRecord {
    let end = bytes.min(u64::from(u32::MAX)) as u32;
    let base = PadRecord {
        original_start: AUDIO_DATA_OFFSET,
        original_end: end,
        user_start: AUDIO_DATA_OFFSET,
        user_end: end,
        volume: 127,
        lofi: 0,
        looping: 0,
        gate: 1,
        reverse: 0,
        format: 1,
        channels,
        tempo_mode: 0,
        original_tempo: DEFAULT_TEMPO,
        user_tempo: DEFAULT_TEMPO,
    };

    edited_record(&base, edit)
}

pub fn emptied_record(base: &PadRecord) -> PadRecord {
    PadRecord {
        original_start: AUDIO_DATA_OFFSET,
        original_end: AUDIO_DATA_OFFSET,
        user_start: AUDIO_DATA_OFFSET,
        user_end: AUDIO_DATA_OFFSET,
        original_tempo: DEFAULT_TEMPO,
        user_tempo: DEFAULT_TEMPO,
        ..*base
    }
}

pub fn patch_pad_records(original: &[u8], changes: &BTreeMap<u8, PadRecord>) -> Result<Vec<u8>> {
    if original.len() < PAD_INFO_BYTE_LENGTH {
        return Err(Error::PadInfoTooShort {
            expected: PAD_INFO_BYTE_LENGTH,
            actual: original.len(),
        });
    }

    let mut patched = original.to_vec();
    for (&slot, record) in changes {
        if usize::from(slot) >= PAD_COUNT {
            return Err(Error::UnknownSlot { slot });
        }
        let offset = usize::from(slot) * BYTES_PER_PAD;
        patched[offset..offset + BYTES_PER_PAD].copy_from_slice(&encode_record(record));
    }

    Ok(patched)
}

fn encode_record(record: &PadRecord) -> [u8; BYTES_PER_PAD] {
    let mut bytes = [0u8; BYTES_PER_PAD];
    bytes[0..4].copy_from_slice(&record.original_start.to_be_bytes());
    bytes[4..8].copy_from_slice(&record.original_end.to_be_bytes());
    bytes[8..12].copy_from_slice(&record.user_start.to_be_bytes());
    bytes[12..16].copy_from_slice(&record.user_end.to_be_bytes());
    bytes[16] = record.volume;
    bytes[17] = record.lofi;
    bytes[18] = record.looping;
    bytes[19] = record.gate;
    bytes[20] = record.reverse;
    bytes[21] = record.format;
    bytes[22] = record.channels;
    bytes[23] = record.tempo_mode;
    bytes[24..28].copy_from_slice(&record.original_tempo.to_be_bytes());
    bytes[28..32].copy_from_slice(&record.user_tempo.to_be_bytes());
    bytes
}

fn clamped_byte_offset(frame: u64, block_align: u32) -> u32 {
    frame_to_byte_offset(frame, block_align).min(u64::from(u32::MAX)) as u32
}

fn region_within(base: &PadRecord, edit: &PadEdit, block_align: u32) -> (u32, u32) {
    let first = byte_offset_to_frame(base.original_start, block_align);
    let last = byte_offset_to_frame(base.original_end, block_align).max(first);
    let start = edit.start_frame.clamp(first, last);
    let end = edit.end_frame.clamp(start, last);

    (
        clamped_byte_offset(start, block_align),
        clamped_byte_offset(end, block_align),
    )
}

fn stored_tempo(tempo: f32) -> u32 {
    (tempo * TEMPO_SCALE).round().clamp(0.0, u32::MAX as f32) as u32
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPresence {
    pub present: bool,
    pub fingerprint: Option<String>,
}

pub fn presence(scopes: &Scopes, card_root: &Path) -> CardPresence {
    match presence_fingerprint(scopes, card_root) {
        Some(fingerprint) => CardPresence {
            present: true,
            fingerprint: Some(fingerprint),
        },
        None => CardPresence {
            present: false,
            fingerprint: None,
        },
    }
}

fn presence_fingerprint(scopes: &Scopes, card_root: &Path) -> Option<String> {
    let root = scopes.readable(card_root).ok()?;
    let samples = sample_directory(&root);
    let pad_info = std::fs::read(samples.join(PAD_INFO_FILE_NAME)).ok()?;

    let mut listing: Vec<(String, u64)> = std::fs::read_dir(&samples)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let length = entry.metadata().ok()?.len();
            Some((entry.file_name().to_string_lossy().into_owned(), length))
        })
        .collect();
    listing.sort();

    let mut hasher = DefaultHasher::new();
    pad_info.hash(&mut hasher);
    listing.hash(&mut hasher);
    Some(format!("{:016x}", hasher.finish()))
}

pub fn read_card(scopes: &Scopes, card_root: &Path) -> Result<LoadedCard> {
    let root = scopes.readable(card_root)?;
    let samples_directory = sample_directory(&root);
    let pad_info_path = samples_directory.join(PAD_INFO_FILE_NAME);

    if !pad_info_path.is_file() {
        return Err(Error::NotACard {
            path: card_root.to_path_buf(),
        });
    }

    let pad_info_raw = std::fs::read(scopes.readable(&pad_info_path)?)?;
    let records = decode_pad_info(&pad_info_raw)?;
    let samples = collect_samples(&samples_directory)?;

    Ok(LoadedCard {
        root,
        pad_info_raw,
        records,
        samples,
    })
}

pub const FINGERPRINT_WINDOW: u64 = 64 * 1024;

pub fn fingerprint(path: &Path, size: u64) -> String {
    let head = hashed_window(path, 0, size.min(FINGERPRINT_WINDOW));
    let tail_start = size.saturating_sub(FINGERPRINT_WINDOW);
    let tail = hashed_window(path, tail_start, size - tail_start);
    format!("size:{size} head:{head} tail:{tail}")
}

fn hashed_window(path: &Path, offset: u64, length: u64) -> String {
    let mut window = vec![0u8; length as usize];
    let read = std::fs::File::open(path).and_then(|mut file| {
        file.seek(SeekFrom::Start(offset))?;
        file.read_exact(&mut window)
    });
    if read.is_err() {
        return "unreadable".to_owned();
    }

    let mut hasher = DefaultHasher::new();
    window.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn collect_samples(samples_directory: &Path) -> Result<Vec<Option<SampleFile>>> {
    let mut samples: Vec<Option<SampleFile>> = vec![None; PAD_COUNT];

    for entry in std::fs::read_dir(samples_directory)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(slot) = slot_from_sample_file_name(&name) else {
            continue;
        };
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            continue;
        }

        let path = samples_directory.join(&name);
        samples[slot as usize] = Some(SampleFile {
            fingerprint: fingerprint(&path, metadata.len()),
            path,
            name,
            size: metadata.len(),
        });
    }

    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PAD_INFO_FIXTURE: &[u8] = include_bytes!("../tests/fixtures/PAD_INFO.BIN");
    const PAD_INFO_AFTER_DELETE_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/PAD_INFO.after-delete-A1.bin");
    const PAD_INFO_AFTER_EDITS_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/PAD_INFO.after-edits.bin");
    const HEADER_FIXTURE: &[u8] = include_bytes!("../tests/fixtures/A0000001.header512.bin");
    const MONO_HEADER_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/C0000009.header512.mono.bin");
    const PAD_INFO_AFTER_AIFF_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/PAD_INFO.after-aiff.bin");
    const AIFF_HEADER_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/A0000001.header512.aiff.bin");

    fn records() -> [PadRecord; PAD_COUNT] {
        decode_pad_info(PAD_INFO_FIXTURE).expect("decode fixture")
    }

    fn table_with(slot: usize, record: &[u8; BYTES_PER_PAD]) -> Vec<u8> {
        let mut bytes = vec![0u8; PAD_INFO_BYTE_LENGTH];
        bytes[slot * BYTES_PER_PAD..(slot + 1) * BYTES_PER_PAD].copy_from_slice(record);
        bytes
    }

    #[test]
    fn every_field_is_read_from_its_documented_offset() {
        let mut record = [0u8; BYTES_PER_PAD];
        record[0..4].copy_from_slice(&1024u32.to_be_bytes());
        record[4..8].copy_from_slice(&2048u32.to_be_bytes());
        record[8..12].copy_from_slice(&1025u32.to_be_bytes());
        record[12..16].copy_from_slice(&2049u32.to_be_bytes());
        record[16] = 101;
        record[17] = 1;
        record[18] = 2;
        record[19] = 3;
        record[20] = 4;
        record[21] = 5;
        record[22] = 6;
        record[23] = 7;
        record[24..28].copy_from_slice(&1200u32.to_be_bytes());
        record[28..32].copy_from_slice(&1201u32.to_be_bytes());

        let decoded = decode_pad_info(&table_with(0, &record)).expect("decode")[0];

        assert_eq!(
            decoded,
            PadRecord {
                original_start: 1024,
                original_end: 2048,
                user_start: 1025,
                user_end: 2049,
                volume: 101,
                lofi: 1,
                looping: 2,
                gate: 3,
                reverse: 4,
                format: 5,
                channels: 6,
                tempo_mode: 7,
                original_tempo: 1200,
                user_tempo: 1201,
            }
        );
    }

    #[test]
    fn a_record_in_the_middle_of_the_table_is_read_at_the_right_stride() {
        let mut record = [0u8; BYTES_PER_PAD];
        record[8..12].copy_from_slice(&9u32.to_be_bytes());
        record[16] = 64;

        let decoded = decode_pad_info(&table_with(47, &record)).expect("decode");

        assert_eq!(decoded[47].user_start, 9);
        assert_eq!(decoded[47].volume, 64);
        assert_eq!(decoded[46].volume, 0);
        assert_eq!(decoded[48].volume, 0);
    }

    #[test]
    fn tempo_is_scaled_down_by_ten_for_the_ui() {
        let mut record = [0u8; BYTES_PER_PAD];
        record[24..28].copy_from_slice(&1234u32.to_be_bytes());
        record[28..32].copy_from_slice(&875u32.to_be_bytes());

        let settings = settings_of(&decode_pad_info(&table_with(0, &record)).expect("decode")[0]);

        assert_eq!(settings.original_tempo, 123.4);
        assert_eq!(settings.user_tempo, 87.5);
    }

    #[test]
    fn the_tempo_mode_byte_maps_to_the_three_known_modes() {
        for (byte, expected) in [
            (0u8, TempoMode::Off),
            (1, TempoMode::Pattern),
            (2, TempoMode::User),
            (200, TempoMode::Off),
        ] {
            let mut record = [0u8; BYTES_PER_PAD];
            record[23] = byte;
            let decoded = decode_pad_info(&table_with(0, &record)).expect("decode")[0];

            assert_eq!(settings_of(&decoded).tempo_mode, expected, "byte {byte}");
        }
    }

    #[test]
    fn the_real_card_decodes_to_one_hundred_and_twenty_uniform_records() {
        let records = records();

        assert_eq!(records.len(), PAD_COUNT);
        for record in &records {
            assert_eq!(record.original_start, AUDIO_DATA_OFFSET);
            assert_eq!(record.user_start, record.original_start);
            assert_eq!(record.user_end, record.original_end);
            assert_eq!(record.volume, 127);
            assert_eq!(record.format, 1);
            assert_eq!(record.channels, 2);
            assert_eq!(record.lofi, 0);
            assert_eq!(record.looping, 0);
            assert_eq!(record.gate, 1);
            assert_eq!(record.reverse, 0);
            assert!(record.original_end > record.original_start);
        }
    }

    #[test]
    fn every_tempo_on_the_real_card_sits_in_the_measured_range() {
        for record in &records() {
            let tempo = record.original_tempo as f32 / TEMPO_SCALE;
            assert!(
                (118.1..=122.4).contains(&tempo),
                "tempo {tempo} outside the measured range"
            );
        }
    }

    #[test]
    fn the_first_record_matches_the_bytes_measured_off_the_card() {
        let first = records()[0];

        assert_eq!(first.original_start, 512);
        assert_eq!(first.original_end, 25_412_504);
        assert_eq!(first.original_tempo, 1199);
        assert_eq!(first.tempo_mode, 0);
    }

    #[test]
    fn the_sample_header_fixture_agrees_with_the_records_end_offset() {
        let declared_riff_size = u32::from_le_bytes([
            HEADER_FIXTURE[4],
            HEADER_FIXTURE[5],
            HEADER_FIXTURE[6],
            HEADER_FIXTURE[7],
        ]);

        assert_eq!(&HEADER_FIXTURE[0..4], b"RIFF");
        assert_eq!(&HEADER_FIXTURE[38..42], b"RLND");
        assert_eq!(&HEADER_FIXTURE[46..54], b"roifspsx");
        assert_eq!(&HEADER_FIXTURE[54..58], &4u32.to_le_bytes());
        assert_eq!(
            HEADER_FIXTURE[58], 0,
            "SampleIndex of A0000001.WAV is slot 0"
        );
        assert_eq!(&HEADER_FIXTURE[504..508], b"data");
        assert_eq!(declared_riff_size + 8, records()[0].original_end);
    }

    #[test]
    fn sample_file_names_round_trip_for_the_bank_boundaries() {
        for (slot, name) in [
            (0u8, "A0000001.WAV"),
            (11, "A0000012.WAV"),
            (12, "B0000001.WAV"),
            (119, "J0000012.WAV"),
        ] {
            assert_eq!(sample_file_name(slot), name);
            assert_eq!(slot_from_sample_file_name(name), Some(slot));
        }
    }

    #[test]
    fn names_that_are_not_pad_samples_are_ignored() {
        for name in [
            "PAD_INFO.BIN",
            "STPINFO.BIN",
            "K0000001.WAV",
            "A0000013.WAV",
            "A0000000.WAV",
            "A000001.WAV",
            "A0000001.TXT",
            "A0000001",
        ] {
            assert_eq!(slot_from_sample_file_name(name), None, "{name}");
        }
    }

    #[test]
    fn lowercase_and_aiff_sample_names_still_resolve() {
        assert_eq!(slot_from_sample_file_name("b0000005.wav"), Some(16));
        assert_eq!(slot_from_sample_file_name("A0000001.AIF"), Some(0));
    }

    #[test]
    fn byte_offsets_convert_to_frames_using_the_block_alignment() {
        let stereo = block_align(2);

        assert_eq!(byte_offset_to_frame(512, stereo), 0);
        assert_eq!(byte_offset_to_frame(25_412_504, stereo), 6_352_998);
        assert_eq!(frame_to_byte_offset(0, stereo), 512);
        assert_eq!(frame_to_byte_offset(6_352_998, stereo), 25_412_504);
    }

    #[test]
    fn a_mono_pad_converts_at_half_the_stride() {
        // unverified — no mono pad exists on the measured card (plan §1.4.2).
        // This pins the obvious reading so a real mono card can contradict it loudly.
        let mono = block_align(1);

        assert_eq!(mono, 2);
        assert_eq!(byte_offset_to_frame(1012, mono), 250);
    }

    #[test]
    fn a_zero_channel_count_never_divides_by_zero() {
        assert_eq!(block_align(0), 2);
        assert_eq!(byte_offset_to_frame(512, block_align(0)), 0);
    }

    #[test]
    fn a_short_buffer_is_an_error_rather_than_a_panic() {
        assert!(matches!(
            decode_pad_info(&[0u8; PAD_INFO_BYTE_LENGTH - 1]),
            Err(Error::PadInfoTooShort { .. })
        ));
        assert!(decode_pad_info(&[]).is_err());
    }

    #[test]
    fn trailing_bytes_beyond_the_records_are_ignored() {
        let mut padded = PAD_INFO_FIXTURE.to_vec();
        padded.extend_from_slice(&[0xff; 64]);

        assert_eq!(decode_pad_info(&padded).expect("decode"), records());
    }

    struct Card {
        _root: TempDir,
        path: PathBuf,
        scopes: Scopes,
    }

    fn card_with(files: &[(&str, u64)]) -> Card {
        let root = TempDir::new().expect("temp dir");
        let path = root.path().join("CARD");
        let samples = sample_directory(&path);
        std::fs::create_dir_all(&samples).expect("create dirs");
        std::fs::write(samples.join(PAD_INFO_FILE_NAME), PAD_INFO_FIXTURE).expect("pad info");
        for (name, size) in files {
            std::fs::write(samples.join(name), vec![0u8; *size as usize]).expect("sample");
        }

        let mut scopes = Scopes::new(&root.path().join("app-data")).expect("scopes");
        scopes.set_card_root(Some(&path)).expect("card root");

        Card {
            _root: root,
            path,
            scopes,
        }
    }

    #[test]
    fn a_card_reports_a_slot_for_every_pad_and_a_sample_only_where_a_file_exists() {
        let card = card_with(&[("A0000001.WAV", 25_412_504), ("J0000012.WAV", 1024)]);

        let state = read_card(&card.scopes, &card.path).expect("read").state();

        assert_eq!(state.slots.len(), PAD_COUNT);
        assert_eq!(state.slots[0].slot, 0);
        let first = state.slots[0].sample.as_ref().expect("sample on slot 0");
        assert_eq!(first.file_name, "A0000001.WAV");
        assert_eq!(first.format, SampleFormat::Wave);
        assert_eq!(first.channels, 2);
        assert_eq!(first.start_frame, 0);
        assert_eq!(first.end_frame, 6_352_998);
        assert_eq!(first.frames, 6_352_998);
        assert!(state.slots[1].sample.is_none());
        assert!(state.slots[119].sample.is_some());
    }

    #[test]
    fn settings_reach_the_ui_without_a_single_byte_offset() {
        let card = card_with(&[]);
        let state = read_card(&card.scopes, &card.path).expect("read").state();

        let json = serde_json::to_string(&state.slots[0].settings).expect("serialize");

        assert!(json.contains("\"volume\":127"));
        assert!(json.contains("\"loop\":false"));
        assert!(json.contains("\"gate\":true"));
        assert!(json.contains("\"tempoMode\":\"off\""));
        assert!(!json.contains("512"), "byte offsets must not reach the UI");
    }

    #[test]
    fn a_folder_without_the_pad_data_file_is_a_clear_error() {
        let root = TempDir::new().expect("temp dir");
        let plain = root.path().join("holiday-photos");
        std::fs::create_dir_all(&plain).expect("create dir");
        let mut scopes = Scopes::new(&root.path().join("app-data")).expect("scopes");
        scopes.set_card_root(Some(&plain)).expect("card root");

        assert!(matches!(
            read_card(&scopes, &plain),
            Err(Error::NotACard { .. })
        ));
    }

    #[test]
    fn a_card_outside_the_scopes_is_refused_before_anything_is_read() {
        let card = card_with(&[]);
        let elsewhere = card.path.with_file_name("OTHER");
        std::fs::create_dir_all(sample_directory(&elsewhere)).expect("create dirs");

        assert!(read_card(&card.scopes, &elsewhere).is_err());
    }

    #[test]
    fn the_raw_pad_data_is_kept_untouched_for_later_writes() {
        let card = card_with(&[]);

        let loaded = read_card(&card.scopes, &card.path).expect("read");

        assert_eq!(loaded.pad_info_raw(), PAD_INFO_FIXTURE);
        assert_eq!(loaded.pad_info_raw().len(), PAD_INFO_BYTE_LENGTH);
    }

    #[test]
    fn stray_files_in_the_sample_folder_are_left_alone() {
        let card = card_with(&[("A0000001.WAV", 1024)]);
        let samples = sample_directory(&card.path);
        std::fs::write(samples.join("STPINFO.BIN"), [0u8; 124]).expect("stpinfo");

        let state = read_card(&card.scopes, &card.path).expect("read").state();

        assert_eq!(state.slots.iter().filter(|s| s.sample.is_some()).count(), 1);
        assert!(samples.join("STPINFO.BIN").exists());
    }

    fn record_bytes(bytes: &[u8], slot: usize) -> &[u8] {
        &bytes[slot * BYTES_PER_PAD..(slot + 1) * BYTES_PER_PAD]
    }

    fn edit_of(record: &PadRecord) -> PadEdit {
        let block_align = block_align(record.channels);
        PadEdit {
            settings: settings_of(record),
            start_frame: byte_offset_to_frame(record.user_start, block_align),
            end_frame: byte_offset_to_frame(record.user_end, block_align),
        }
    }

    #[test]
    fn encoding_a_decoded_record_reproduces_the_bytes_on_the_real_card() {
        for slot in 0..PAD_COUNT {
            let encoded = encode_record(&records()[slot]);

            assert_eq!(encoded, record_bytes(PAD_INFO_FIXTURE, slot), "slot {slot}");
        }
    }

    #[test]
    fn patching_no_slots_returns_the_card_bytes_untouched() {
        let patched = patch_pad_records(PAD_INFO_FIXTURE, &BTreeMap::new()).expect("patch");

        assert_eq!(patched, PAD_INFO_FIXTURE);
    }

    #[test]
    fn patching_one_slot_leaves_every_other_record_byte_identical() {
        let mut edited = records()[47];
        edited.volume = 64;
        edited.looping = 1;
        let changes = BTreeMap::from([(47u8, edited)]);

        let patched = patch_pad_records(PAD_INFO_FIXTURE, &changes).expect("patch");

        assert_eq!(patched.len(), PAD_INFO_FIXTURE.len());
        for slot in 0..PAD_COUNT {
            if slot == 47 {
                continue;
            }
            assert_eq!(
                record_bytes(&patched, slot),
                record_bytes(PAD_INFO_FIXTURE, slot),
                "slot {slot} was rewritten by a patch that did not name it"
            );
        }
        assert_ne!(
            record_bytes(&patched, 47),
            record_bytes(PAD_INFO_FIXTURE, 47)
        );
    }

    #[test]
    fn a_patched_record_decodes_back_to_what_was_written() {
        let mut edited = records()[3];
        edited.volume = 12;
        edited.reverse = 1;
        edited.user_start = 1024;
        edited.user_end = 4096;
        edited.user_tempo = 1740;

        let patched =
            patch_pad_records(PAD_INFO_FIXTURE, &BTreeMap::from([(3u8, edited)])).expect("patch");

        assert_eq!(decode_pad_info(&patched).expect("decode")[3], edited);
    }

    #[test]
    fn bytes_beyond_the_records_survive_a_patch() {
        let mut table = PAD_INFO_FIXTURE.to_vec();
        table.extend_from_slice(&[0xab; 16]);

        let patched =
            patch_pad_records(&table, &BTreeMap::from([(0u8, records()[0])])).expect("patch");

        assert_eq!(&patched[PAD_INFO_BYTE_LENGTH..], &[0xab; 16]);
    }

    #[test]
    fn patching_a_slot_beyond_the_last_pad_is_refused() {
        let changes = BTreeMap::from([(PAD_COUNT as u8, records()[0])]);

        assert!(matches!(
            patch_pad_records(PAD_INFO_FIXTURE, &changes),
            Err(Error::UnknownSlot { slot: 120 })
        ));
    }

    #[test]
    fn patching_a_table_that_is_too_short_is_an_error_rather_than_a_panic() {
        assert!(matches!(
            patch_pad_records(&[0u8; PAD_INFO_BYTE_LENGTH - 1], &BTreeMap::new()),
            Err(Error::PadInfoTooShort { .. })
        ));
    }

    #[test]
    fn an_unedited_pad_encodes_to_the_bytes_it_came_from() {
        for slot in 0..PAD_COUNT {
            let original = records()[slot];

            let round_tripped = edited_record(&original, &edit_of(&original));

            assert_eq!(round_tripped, original, "slot {slot}");
        }
    }

    #[test]
    fn an_edit_writes_the_region_back_as_byte_offsets_at_the_pads_stride() {
        let stereo = records()[0];
        let edit = PadEdit {
            start_frame: 1_000,
            end_frame: 6_352_998,
            ..edit_of(&stereo)
        };

        let edited = edited_record(&stereo, &edit);

        assert_eq!(edited.user_start, 512 + 1_000 * 4);
        assert_eq!(edited.user_end, 25_412_504);
    }

    #[test]
    fn a_region_reaching_past_the_file_is_pulled_back_to_its_last_frame() {
        let stereo = records()[0];
        let frames = u64::from(stereo.original_end - stereo.original_start) / 4;
        let edit = PadEdit {
            start_frame: 1_000,
            end_frame: frames + 500_000,
            ..edit_of(&stereo)
        };

        let edited = edited_record(&stereo, &edit);

        assert_eq!(edited.user_end, stereo.original_end);
        assert!(edited.user_start < edited.user_end);
    }

    #[test]
    fn a_region_starting_past_the_file_collapses_at_its_last_frame() {
        let stereo = records()[0];
        let edit = PadEdit {
            start_frame: u64::MAX,
            end_frame: u64::MAX,
            ..edit_of(&stereo)
        };

        let edited = edited_record(&stereo, &edit);

        assert_eq!(edited.user_start, stereo.original_end);
        assert_eq!(edited.user_end, stereo.original_end);
    }

    #[test]
    fn a_region_whose_end_precedes_its_start_is_never_written_inverted() {
        let stereo = records()[0];
        let edit = PadEdit {
            start_frame: 40_000,
            end_frame: 12,
            ..edit_of(&stereo)
        };

        let edited = edited_record(&stereo, &edit);

        assert_eq!(edited.user_start, 512 + 40_000 * 4);
        assert_eq!(edited.user_end, edited.user_start);
    }

    #[test]
    fn a_clamped_region_still_lands_on_whole_frames() {
        let mut mono = records()[0];
        mono.channels = 1;
        mono.original_end = mono.original_start + 3 * 2 + 1;
        let edit = PadEdit {
            start_frame: 0,
            end_frame: u64::MAX,
            ..edit_of(&mono)
        };

        let edited = edited_record(&mono, &edit);

        assert_eq!((edited.user_end - AUDIO_DATA_OFFSET) % 2, 0);
        assert_eq!(edited.user_end, mono.original_start + 3 * 2);
    }

    #[test]
    fn a_volume_above_the_cards_range_is_capped_rather_than_written_through() {
        let original = records()[0];
        let edit = PadEdit {
            settings: PadSettings {
                volume: 240,
                ..settings_of(&original)
            },
            ..edit_of(&original)
        };

        let edited = edited_record(&original, &edit);

        assert_eq!(edited.volume, MAX_VOLUME);
    }

    #[test]
    fn a_recorded_sample_cannot_be_given_a_region_longer_than_what_was_written() {
        let bytes = u64::from(AUDIO_DATA_OFFSET) + 4_000;
        let edit = PadEdit {
            start_frame: 0,
            end_frame: 100_000,
            ..edit_of(&records()[0])
        };

        let recorded = recorded_record(2, bytes, &edit);

        assert_eq!(recorded.user_end, recorded.original_end);
        assert_eq!(recorded.user_end, bytes as u32);
    }

    #[test]
    fn an_edit_leaves_the_fields_only_the_card_owns_alone() {
        let original = records()[0];
        let edit = PadEdit {
            settings: PadSettings {
                volume: 40,
                ..settings_of(&original)
            },
            ..edit_of(&original)
        };

        let edited = edited_record(&original, &edit);

        assert_eq!(edited.volume, 40);
        assert_eq!(edited.format, original.format);
        assert_eq!(edited.channels, original.channels);
        assert_eq!(edited.original_start, original.original_start);
        assert_eq!(edited.original_end, original.original_end);
    }

    #[test]
    fn an_edit_stores_tempo_at_ten_times_the_displayed_value() {
        let original = records()[0];
        let edit = PadEdit {
            settings: PadSettings {
                original_tempo: 87.5,
                user_tempo: 174.0,
                tempo_mode: TempoMode::User,
                ..settings_of(&original)
            },
            ..edit_of(&original)
        };

        let edited = edited_record(&original, &edit);

        assert_eq!(edited.original_tempo, 875);
        assert_eq!(edited.user_tempo, 1740);
        assert_eq!(edited.tempo_mode, 2);
    }

    #[test]
    fn the_switches_reach_the_card_as_the_bytes_it_uses() {
        let original = records()[0];
        let edit = PadEdit {
            settings: PadSettings {
                lofi: true,
                looping: true,
                gate: false,
                reverse: true,
                ..settings_of(&original)
            },
            ..edit_of(&original)
        };

        let edited = edited_record(&original, &edit);

        assert_eq!(
            (edited.lofi, edited.looping, edited.gate, edited.reverse),
            (1, 1, 0, 1)
        );
    }

    #[test]
    fn a_region_beyond_the_addressable_range_clamps_rather_than_wrapping() {
        let original = records()[0];
        let edit = PadEdit {
            start_frame: 0,
            end_frame: u64::MAX,
            ..edit_of(&original)
        };

        let edited = edited_record(&original, &edit);

        assert_ne!(edited.user_end, u32::MAX);
        assert_eq!(edited.user_end, original.original_end);
    }

    #[test]
    fn the_hardware_empties_a_pad_by_collapsing_its_region_not_by_zeroing_the_record() {
        let before = decode_pad_info(PAD_INFO_FIXTURE).expect("decode before")[0];
        let after = decode_pad_info(PAD_INFO_AFTER_DELETE_FIXTURE).expect("decode after")[0];

        assert_eq!(before.original_end, 25_412_504);
        assert_eq!(
            after,
            PadRecord {
                original_start: AUDIO_DATA_OFFSET,
                original_end: AUDIO_DATA_OFFSET,
                user_start: AUDIO_DATA_OFFSET,
                user_end: AUDIO_DATA_OFFSET,
                original_tempo: 1200,
                user_tempo: 1200,
                ..before
            }
        );
    }

    #[test]
    fn emptying_a_pad_leaves_every_other_record_untouched() {
        let before = decode_pad_info(PAD_INFO_FIXTURE).expect("decode before");
        let after = decode_pad_info(PAD_INFO_AFTER_DELETE_FIXTURE).expect("decode after");

        assert_eq!(before[1..], after[1..]);
    }

    #[test]
    fn an_emptied_pad_keeps_stale_format_and_channels_so_only_the_region_says_it_is_empty() {
        let after = decode_pad_info(PAD_INFO_AFTER_DELETE_FIXTURE).expect("decode after")[0];

        assert_eq!(after.format, 1);
        assert_eq!(after.channels, 2);
        assert_eq!(after.original_end, after.original_start);
    }

    fn before_edits() -> [PadRecord; PAD_COUNT] {
        decode_pad_info(PAD_INFO_AFTER_DELETE_FIXTURE).expect("decode before edits")
    }

    fn after_edits() -> [PadRecord; PAD_COUNT] {
        decode_pad_info(PAD_INFO_AFTER_EDITS_FIXTURE).expect("decode after edits")
    }

    fn seconds_of(record: &PadRecord) -> f64 {
        let frames = byte_offset_to_frame(record.user_end, block_align(record.channels))
            - byte_offset_to_frame(record.user_start, block_align(record.channels));
        frames as f64 / 44_100.0
    }

    #[test]
    fn trimming_moves_only_the_user_offsets_and_leaves_the_original_span_alone() {
        let before = before_edits()[1];
        let after = after_edits()[1];

        assert_eq!(after.original_start, before.original_start);
        assert_eq!(after.original_end, before.original_end);
        assert_eq!((before.user_start, before.user_end), (512, 40_585_636));
        assert_eq!((after.user_start, after.user_end), (4_817_920, 6_521_600));
        assert_eq!(after.volume, 19);
    }

    #[test]
    fn a_trim_point_lands_on_a_whole_frame() {
        let after = after_edits()[1];
        let align = block_align(after.channels);

        assert_eq!((after.user_start - AUDIO_DATA_OFFSET) % align, 0);
        assert_eq!((after.user_end - AUDIO_DATA_OFFSET) % align, 0);
    }

    #[test]
    fn changing_speed_sets_the_tempo_mode_and_the_user_tempo_only() {
        let before = before_edits()[2];
        let after = after_edits()[2];

        assert_eq!(before.tempo_mode, 0);
        assert_eq!(after.tempo_mode, 1);
        assert_eq!(after.original_tempo, before.original_tempo);
        assert_eq!((before.user_tempo, after.user_tempo), (1206, 1540));
        assert_eq!(after.user_start, before.user_start);
        assert_eq!(after.user_end, before.user_end);
    }

    #[test]
    fn every_playback_flag_sits_where_the_table_says_it_does() {
        let before = before_edits()[4];
        let after = after_edits()[4];

        assert_eq!(
            (before.lofi, before.looping, before.gate, before.reverse),
            (0, 0, 1, 0)
        );
        assert_eq!(
            (after.lofi, after.looping, after.gate, after.reverse),
            (1, 1, 0, 1)
        );
        assert_eq!(after.volume, before.volume);
    }

    #[test]
    fn swapping_two_pads_swaps_their_records_whole() {
        let before = before_edits();
        let after = after_edits();

        assert_eq!(after[3], before[7]);
        assert_eq!(after[7], before[3]);
    }

    #[test]
    fn a_mono_pad_records_one_channel_not_a_stereo_flag() {
        let before = before_edits()[32];
        let after = after_edits()[32];

        assert_eq!(before.channels, 2);
        assert_eq!(after.channels, 1);
        assert_eq!(block_align(after.channels), 2);
        assert_eq!(&MONO_HEADER_FIXTURE[22..24], &1u16.to_le_bytes());
        assert_eq!(MONO_HEADER_FIXTURE[58], 32, "SampleIndex of C0000009.WAV");
    }

    #[test]
    fn the_device_derives_a_tempo_from_the_region_as_a_whole_number_of_bars() {
        for (slot, bars) in [(1usize, 5.0f64), (32, 4.0)] {
            let record = after_edits()[slot];
            let expected = (240.0 * bars / seconds_of(&record) * 10.0).trunc() as u32;

            assert_eq!(
                record.original_tempo, expected,
                "slot {slot} should read as {bars} bars"
            );
            assert_eq!(record.user_tempo, record.original_tempo);
        }
    }

    #[test]
    fn the_offset_field_and_fat32_cap_a_pad_at_the_very_same_byte() {
        const FAT32_MAX_FILE_SIZE: u64 = 4 * 1024 * 1024 * 1024 - 1;

        assert_eq!(u64::from(u32::MAX), FAT32_MAX_FILE_SIZE);

        let audio_bytes = u32::MAX - AUDIO_DATA_OFFSET;
        let stereo_hours = audio_bytes / (44_100 * block_align(2)) / 3_600;
        let mono_hours = audio_bytes / (44_100 * block_align(1)) / 3_600;

        assert_eq!((stereo_hours, mono_hours), (6, 13));
    }

    #[test]
    fn the_documented_per_sample_cap_binds_long_before_the_format_ceiling() {
        const DOCUMENTED_STEREO_MINUTES: u32 = 180;
        let cap = DOCUMENTED_STEREO_MINUTES * 60 * 44_100 * block_align(2);

        assert_eq!(cap, 1_905_120_000);
        assert!(cap < u32::MAX - AUDIO_DATA_OFFSET);
        assert_eq!(cap / (44_100 * block_align(1)) / 60, 360);
    }

    #[test]
    fn the_per_sample_cap_and_card_capacity_are_separate_limits_that_meet_at_two_gigabytes() {
        let per_sample_minutes = 180u64;
        let capacity_minutes = |gigabytes: u64| gigabytes * 90;

        assert!(capacity_minutes(1) < per_sample_minutes);
        assert_eq!(capacity_minutes(2), per_sample_minutes);
        assert!(capacity_minutes(32) > per_sample_minutes);
    }

    #[test]
    fn an_offset_at_the_top_of_the_field_still_decodes() {
        let mut record = [0u8; BYTES_PER_PAD];
        record[0..4].copy_from_slice(&AUDIO_DATA_OFFSET.to_be_bytes());
        record[4..8].copy_from_slice(&u32::MAX.to_be_bytes());
        record[8..12].copy_from_slice(&AUDIO_DATA_OFFSET.to_be_bytes());
        record[12..16].copy_from_slice(&u32::MAX.to_be_bytes());
        record[22] = 2;

        let decoded = decode_pad_info(&table_with(0, &record)).expect("decode")[0];

        assert_eq!(decoded.user_end, u32::MAX);
        assert_eq!(
            byte_offset_to_frame(decoded.user_end, block_align(decoded.channels)),
            1_073_741_695
        );
    }

    fn after_aiff() -> [PadRecord; PAD_COUNT] {
        decode_pad_info(PAD_INFO_AFTER_AIFF_FIXTURE).expect("decode after aiff")
    }

    #[test]
    fn recording_an_aiff_sets_the_format_byte_to_zero() {
        let before = after_edits()[0];
        let after = after_aiff()[0];

        assert_eq!(before.format, 1);
        assert_eq!(after.format, 0);
        assert_eq!(
            sample_info(
                &after,
                &SampleFile {
                    name: "A0000001.AIF".to_owned(),
                    path: PathBuf::from("A0000001.AIF"),
                    size: 1_073_024,
                    fingerprint: String::new(),
                }
            )
            .format,
            SampleFormat::Aiff
        );
    }

    #[test]
    fn an_aiff_pad_fills_the_region_that_the_delete_had_collapsed() {
        let before = after_edits()[0];
        let after = after_aiff()[0];

        assert_eq!((before.original_start, before.original_end), (512, 512));
        assert_eq!((after.original_start, after.original_end), (512, 1_073_024));
        assert_eq!((after.user_start, after.user_end), (512, 1_073_024));
    }

    #[test]
    fn only_the_recorded_pad_changed_when_the_aiff_landed() {
        assert_eq!(after_edits()[1..], after_aiff()[1..]);
    }

    #[test]
    fn an_aiff_lays_its_chunks_out_four_bytes_later_but_still_starts_audio_at_512() {
        let aiff = AIFF_HEADER_FIXTURE;

        assert_eq!(&aiff[0..4], b"FORM");
        assert_eq!(&aiff[8..12], b"AIFF");
        assert_eq!(&aiff[12..16], b"COMM");
        assert_eq!(&aiff[38..42], b"APPL");
        assert_eq!(&aiff[46..50], b"RLND", "the OSType the WAV uses as a chunk id");
        assert_eq!(&aiff[50..58], b"roifspsx");
        assert_eq!(&aiff[58..62], &4u32.to_be_bytes(), "the WAV writes this little-endian at 54");

        let appl_size = u32::from_be_bytes([aiff[42], aiff[43], aiff[44], aiff[45]]);
        assert_eq!(appl_size, 450);
        assert_eq!(&HEADER_FIXTURE[42..46], &458u32.to_le_bytes());
        assert_eq!(&aiff[496..500], b"SSND");
        assert_eq!(
            appl_size + 8,
            458,
            "the SSND offset and blockSize fields are what the AIFF gives back"
        );
    }

    #[test]
    fn an_aiff_header_declares_the_same_audio_the_record_points_at() {
        let aiff = AIFF_HEADER_FIXTURE;
        let record = after_aiff()[0];

        let channels = u16::from_be_bytes([aiff[20], aiff[21]]);
        let frames = u32::from_be_bytes([aiff[22], aiff[23], aiff[24], aiff[25]]);
        let bits = u16::from_be_bytes([aiff[26], aiff[27]]);

        assert_eq!((channels, bits), (2, 16));
        assert_eq!(u32::from(channels), u32::from(record.channels));
        assert_eq!(
            frames,
            byte_offset_to_frame(record.original_end, block_align(record.channels)) as u32
        );
    }

    #[test]
    fn an_aiff_is_found_by_its_three_letter_extension() {
        assert_eq!(slot_from_sample_file_name("A0000001.AIF"), Some(0));
        assert_eq!(slot_from_sample_file_name("C0000009.AIFF"), Some(32));
    }

    #[test]
    fn the_whole_bars_tempo_holds_for_the_aiff_too() {
        let record = after_aiff()[0];
        let expected = (240.0 * 4.0 / seconds_of(&record) * 10.0).trunc() as u32;

        assert_eq!(record.original_tempo, expected);
        assert_eq!(record.original_tempo, 1578);
    }

    const PAD_INFO_AFTER_TEMPO_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/PAD_INFO.after-tempo.bin");
    const AIFF_MONO_HEADER_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/G0000002.header512.aiff-mono.bin");
    const STP_INFO_FIXTURE: &[u8] = include_bytes!("../tests/fixtures/STPINFO.BIN");
    const STP_INFO_AFTER_TEMPO_FIXTURE: &[u8] =
        include_bytes!("../tests/fixtures/STPINFO.after-tempo.bin");

    fn after_tempo() -> [PadRecord; PAD_COUNT] {
        decode_pad_info(PAD_INFO_AFTER_TEMPO_FIXTURE).expect("decode after tempo")
    }

    #[test]
    fn the_sample_index_is_a_u32_in_each_formats_own_endianness() {
        assert_eq!(&HEADER_FIXTURE[54..58], &4u32.to_le_bytes());
        assert_eq!(&HEADER_FIXTURE[58..62], &0u32.to_le_bytes(), "A0000001 is slot 0");

        assert_eq!(&AIFF_MONO_HEADER_FIXTURE[58..62], &4u32.to_be_bytes());
        assert_eq!(
            &AIFF_MONO_HEADER_FIXTURE[62..66],
            &73u32.to_be_bytes(),
            "G0000002 is slot 73, and its high bytes are what byte 62 alone would miss"
        );
        assert_eq!(AIFF_MONO_HEADER_FIXTURE[62], 0);
        assert_eq!(AIFF_MONO_HEADER_FIXTURE[65], 73);
    }

    #[test]
    fn an_aiff_can_be_mono_too() {
        let record = after_tempo()[73];

        assert_eq!((record.format, record.channels), (0, 1));
        assert_eq!(&AIFF_MONO_HEADER_FIXTURE[20..22], &1u16.to_be_bytes());
        assert_eq!(
            u32::from_be_bytes([
                AIFF_MONO_HEADER_FIXTURE[22],
                AIFF_MONO_HEADER_FIXTURE[23],
                AIFF_MONO_HEADER_FIXTURE[24],
                AIFF_MONO_HEADER_FIXTURE[25],
            ]),
            byte_offset_to_frame(record.original_end, block_align(record.channels)) as u32
        );
    }

    #[test]
    fn setting_a_tempo_by_hand_is_the_third_tempo_mode() {
        let before = after_aiff()[73];
        let after = after_tempo()[73];

        assert_eq!(before.tempo_mode, 0);
        assert_eq!(after.tempo_mode, 2);
        assert_eq!(settings_of(&after).tempo_mode, TempoMode::User);
        assert_eq!(settings_of(&after_edits()[2]).tempo_mode, TempoMode::Pattern);
    }

    #[test]
    fn a_hand_set_tempo_replaces_the_derived_one_in_both_fields() {
        let record = after_tempo()[73];
        let derived = (240.0 * 4.0 / seconds_of(&record) * 10.0).trunc() as u32;

        assert_eq!(derived, 1361, "what the device would have computed");
        assert_eq!(record.original_tempo, 1360, "what the user typed");
        assert_eq!(record.user_tempo, record.original_tempo);
    }

    #[test]
    fn only_the_recorded_pad_changed_when_the_tempo_was_set() {
        let before = after_aiff();
        let after = after_tempo();

        assert_eq!(before[..73], after[..73]);
        assert_eq!(before[74..], after[74..]);
    }

    #[test]
    fn the_undocumented_side_file_is_live_state_the_device_rewrites() {
        assert_eq!(STP_INFO_FIXTURE.len(), STP_INFO_AFTER_TEMPO_FIXTURE.len());

        let changed: Vec<usize> = (0..STP_INFO_FIXTURE.len())
            .filter(|&at| STP_INFO_FIXTURE[at] != STP_INFO_AFTER_TEMPO_FIXTURE[at])
            .collect();

        assert_eq!(changed, vec![15]);
        assert_eq!((STP_INFO_FIXTURE[15], STP_INFO_AFTER_TEMPO_FIXTURE[15]), (1, 0));
    }
    #[test]
    fn presence_notices_the_card_going_away_and_coming_back() {
        let (dir, scopes, root) = presence_fixture();

        let before = presence(&scopes, &root);
        assert!(before.present);

        let samples = sample_directory(&root);
        let pad_info = samples.join(PAD_INFO_FILE_NAME);
        let bytes = std::fs::read(&pad_info).expect("read");
        std::fs::remove_file(&pad_info).expect("remove");
        assert!(!presence(&scopes, &root).present);

        std::fs::write(&pad_info, &bytes).expect("restore");
        assert_eq!(presence(&scopes, &root), before);
        drop(dir);
    }

    #[test]
    fn presence_changes_when_the_hardware_edits_the_card() {
        let (_dir, scopes, root) = presence_fixture();
        let before = presence(&scopes, &root);

        let pad_info = sample_directory(&root).join(PAD_INFO_FILE_NAME);
        let mut bytes = std::fs::read(&pad_info).expect("read");
        bytes[16] = 64;
        std::fs::write(&pad_info, &bytes).expect("write");

        assert_ne!(presence(&scopes, &root), before);
    }

    #[test]
    fn presence_changes_when_a_sample_is_added_or_resized() {
        let (_dir, scopes, root) = presence_fixture();
        let before = presence(&scopes, &root);
        let samples = sample_directory(&root);

        std::fs::write(samples.join(sample_file_name(9)), vec![0u8; 600]).expect("write");
        let added = presence(&scopes, &root);
        assert_ne!(added, before);

        std::fs::write(samples.join(sample_file_name(9)), vec![0u8; 800]).expect("write");
        assert_ne!(presence(&scopes, &root), added);
    }

    #[test]
    fn presence_is_absent_for_a_folder_outside_every_scope() {
        let (dir, scopes, _root) = presence_fixture();
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir_all(&elsewhere).expect("create");

        assert!(!presence(&scopes, &elsewhere).present);
    }

    fn presence_fixture() -> (TempDir, Scopes, PathBuf) {
        let dir = TempDir::new().expect("temp dir");
        let root = dir.path().join("card");
        let samples = sample_directory(&root);
        std::fs::create_dir_all(&samples).expect("dirs");
        std::fs::write(samples.join(PAD_INFO_FILE_NAME), vec![0u8; PAD_INFO_BYTE_LENGTH])
            .expect("pad info");
        std::fs::write(samples.join(sample_file_name(0)), vec![0u8; 512]).expect("sample");

        let mut scopes = Scopes::new(&dir.path().join("data")).expect("scopes");
        scopes.set_card_root(Some(&root)).expect("card root");
        (dir, scopes, root)
    }
}
