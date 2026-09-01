use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::audio::peaks::PeakChunks;
use crate::error::Result;

const MAGIC: &[u8; 4] = b"PBPK";
const VERSION: u8 = 2;
const HEADER_LENGTH: usize = 4 + 1 + 8 + 2 + 4 + 4 + 4;

pub fn cache_directory(app_data: &Path) -> PathBuf {
    app_data.join("peaks")
}

pub fn cache_key(path: &Path) -> Result<String> {
    let metadata = std::fs::metadata(path)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);

    Ok(format!("{:016x}", hasher.finish()))
}

pub fn load(app_data: &Path, key: &str) -> Option<PeakChunks> {
    let bytes = std::fs::read(cache_directory(app_data).join(key)).ok()?;
    decode(&bytes)
}

pub fn store(app_data: &Path, key: &str, chunks: &PeakChunks) -> Result<()> {
    let directory = cache_directory(app_data);
    std::fs::create_dir_all(&directory)?;

    let path = directory.join(key);
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, encode(chunks))?;
    std::fs::rename(&temporary, &path)?;
    Ok(())
}

fn encode(chunks: &PeakChunks) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_LENGTH + chunks.min_max.len() * 4);
    bytes.extend_from_slice(MAGIC);
    bytes.push(VERSION);
    bytes.extend_from_slice(&chunks.frames.to_le_bytes());
    bytes.extend_from_slice(&chunks.channels.to_le_bytes());
    bytes.extend_from_slice(&chunks.sample_rate.to_le_bytes());
    bytes.extend_from_slice(&chunks.chunk_frames.to_le_bytes());
    bytes.extend_from_slice(&(chunks.min_max.len() as u32).to_le_bytes());
    for value in &chunks.min_max {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode(bytes: &[u8]) -> Option<PeakChunks> {
    if bytes.len() < HEADER_LENGTH || &bytes[0..4] != MAGIC || bytes[4] != VERSION {
        return None;
    }

    let count = u32::from_le_bytes(bytes[23..27].try_into().ok()?) as usize;
    let values = bytes.get(HEADER_LENGTH..HEADER_LENGTH + count * 4)?;

    Some(PeakChunks {
        frames: u64::from_le_bytes(bytes[5..13].try_into().ok()?),
        channels: u16::from_le_bytes(bytes[13..15].try_into().ok()?),
        sample_rate: u32::from_le_bytes(bytes[15..19].try_into().ok()?),
        chunk_frames: u32::from_le_bytes(bytes[19..23].try_into().ok()?),
        min_max: values
            .as_chunks::<4>()
            .0
            .iter()
            .map(|value| f32::from_le_bytes(*value))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn chunks() -> PeakChunks {
        PeakChunks {
            frames: 44_100,
            channels: 2,
            sample_rate: 44_100,
            chunk_frames: 1024,
            min_max: vec![-0.5, 0.5, -0.25, 0.75],
        }
    }

    #[test]
    fn chunks_round_trip_through_the_cache() {
        let dir = TempDir::new().expect("temp dir");

        store(dir.path(), "abc", &chunks()).expect("store");

        assert_eq!(load(dir.path(), "abc"), Some(chunks()));
    }

    #[test]
    fn a_missing_or_corrupt_cache_entry_reads_as_absent() {
        let dir = TempDir::new().expect("temp dir");
        std::fs::create_dir_all(cache_directory(dir.path())).expect("create dir");
        std::fs::write(
            cache_directory(dir.path()).join("junk"),
            b"not a cache file",
        )
        .expect("write");

        assert_eq!(load(dir.path(), "absent"), None);
        assert_eq!(load(dir.path(), "junk"), None);
    }

    #[test]
    fn the_key_changes_when_the_file_changes() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("sample.wav");
        std::fs::write(&path, b"one").expect("write");
        let first = cache_key(&path).expect("key");

        std::fs::write(&path, b"one and a bit more").expect("write");
        let second = cache_key(&path).expect("key");

        assert_ne!(first, second);
        assert_eq!(cache_key(&path).expect("key"), second);
    }

    #[test]
    fn a_key_for_a_missing_file_is_an_error() {
        let dir = TempDir::new().expect("temp dir");

        assert!(cache_key(&dir.path().join("absent.wav")).is_err());
    }
}
