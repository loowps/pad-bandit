use std::path::Path;

use serde::Serialize;

use crate::audio::decode::AudioSource;
use crate::error::Result;

pub const CHUNK_FRAMES: u32 = 1024;
const SAMPLED_FRAMES_PER_COLUMN: u64 = 1024;
const LEAST_EXACT_CHUNKS: u64 = 8192;

fn chunk_frames_for(frames: Option<u64>) -> u32 {
    let Some(frames) = frames.filter(|count| *count > 0) else {
        return CHUNK_FRAMES;
    };
    (frames / LEAST_EXACT_CHUNKS).clamp(1, u64::from(CHUNK_FRAMES)) as u32
}

#[derive(Debug, Clone, PartialEq)]
pub struct PeakChunks {
    pub frames: u64,
    pub channels: u16,
    pub sample_rate: u32,
    pub chunk_frames: u32,
    pub min_max: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peaks {
    pub min_max: Vec<f32>,
    pub columns: usize,
    pub frames: u64,
    pub channels: u16,
    pub sample_rate: u32,
    pub exact: bool,
}

struct Extremes {
    min: f32,
    max: f32,
}

impl Extremes {
    fn empty() -> Self {
        Self {
            min: f32::INFINITY,
            max: f32::NEG_INFINITY,
        }
    }

    fn add(&mut self, value: f32) {
        self.min = self.min.min(value);
        self.max = self.max.max(value);
    }

    fn write_into(&self, target: &mut [f32], column: usize) {
        let (min, max) = if self.min > self.max {
            (0.0, 0.0)
        } else {
            (self.min, self.max)
        };
        target[column * 2] = min;
        target[column * 2 + 1] = max;
    }
}

fn mono_frames(samples: &[f32], channels: usize) -> impl Iterator<Item = f32> + '_ {
    samples
        .chunks_exact(channels)
        .map(move |frame| frame.iter().sum::<f32>() / channels as f32)
}

pub fn sampled_peaks(path: &Path, columns: usize) -> Result<Peaks> {
    let mut source = AudioSource::open(path)?;
    let spec = source.spec();
    let Some(frames) = spec.frames.filter(|frames| *frames > 0) else {
        return Ok(reduce(&exact_chunks(path)?, columns));
    };

    let channels = usize::from(spec.channels.max(1));
    let columns = columns.max(1);
    let mut min_max = vec![0.0f32; columns * 2];

    for column in 0..columns {
        let start = frames * column as u64 / columns as u64;
        let end = (frames * (column as u64 + 1) / columns as u64).max(start + 1);
        let limit = start + (end - start).min(SAMPLED_FRAMES_PER_COLUMN);
        source.seek_to_frame(start)?;

        let mut extremes = Extremes::empty();
        let mut reached = start;
        while reached < limit {
            let Some((at, samples)) = source.next_block()? else {
                break;
            };
            let block = (samples.len() / channels) as u64;
            if block == 0 {
                break;
            }
            let from = start.saturating_sub(at).min(block);
            let to = limit.saturating_sub(at).min(block);
            if to > from {
                let wanted = &samples[from as usize * channels..to as usize * channels];
                for value in mono_frames(wanted, channels) {
                    extremes.add(value);
                }
            }
            reached = at + block;
        }
        extremes.write_into(&mut min_max, column);
    }

    Ok(Peaks {
        min_max,
        columns,
        frames,
        channels: spec.channels,
        sample_rate: spec.sample_rate,
        exact: false,
    })
}

pub fn exact_chunks(path: &Path) -> Result<PeakChunks> {
    let mut source = AudioSource::open(path)?;
    let spec = source.spec();
    let channels = usize::from(spec.channels.max(1));
    let chunk_frames = chunk_frames_for(spec.frames);

    let mut min_max = Vec::new();
    let mut frames: u64 = 0;
    let mut extremes = Extremes::empty();
    let mut in_chunk: u32 = 0;

    while let Some((_, samples)) = source.next_block()? {
        for value in mono_frames(samples, channels) {
            extremes.add(value);
            frames += 1;
            in_chunk += 1;
            if in_chunk == chunk_frames {
                push_chunk(&mut min_max, &extremes);
                extremes = Extremes::empty();
                in_chunk = 0;
            }
        }
    }

    if in_chunk > 0 {
        push_chunk(&mut min_max, &extremes);
    }

    Ok(PeakChunks {
        frames,
        channels: spec.channels,
        sample_rate: spec.sample_rate,
        chunk_frames,
        min_max,
    })
}

fn push_chunk(min_max: &mut Vec<f32>, extremes: &Extremes) {
    let mut pair = [0.0f32; 2];
    extremes.write_into(&mut pair, 0);
    min_max.extend_from_slice(&pair);
}

pub fn reduce(chunks: &PeakChunks, columns: usize) -> Peaks {
    let columns = columns.max(1);
    let total = chunks.min_max.len() / 2;
    let mut min_max = vec![0.0f32; columns * 2];

    for column in 0..columns {
        let from = total * column / columns;
        let to = (total * (column + 1) / columns).max(from + 1).min(total);

        let mut extremes = Extremes::empty();
        for chunk in from..to {
            extremes.add(chunks.min_max[chunk * 2]);
            extremes.add(chunks.min_max[chunk * 2 + 1]);
        }
        extremes.write_into(&mut min_max, column);
    }

    Peaks {
        min_max,
        columns,
        frames: chunks.frames,
        channels: chunks.channels,
        sample_rate: chunks.sample_rate,
        exact: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::testing::{write_late_tone_wav, write_silence_wav, write_tone_wav};
    use tempfile::TempDir;

    const SAMPLE_RATE: u32 = 44_100;

    #[test]
    fn a_tone_peaks_symmetrically_and_stays_inside_full_scale() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("tone.wav");
        write_tone_wav(&path, 440.0, SAMPLE_RATE, SAMPLE_RATE, 2, 0.8);

        let peaks = sampled_peaks(&path, 64).expect("peaks");

        assert_eq!(peaks.min_max.len(), 128);
        assert_eq!(peaks.channels, 2);
        assert_eq!(peaks.sample_rate, SAMPLE_RATE);
        assert_eq!(peaks.frames, u64::from(SAMPLE_RATE));
        assert!(!peaks.exact);

        for column in 0..64 {
            let min = peaks.min_max[column * 2];
            let max = peaks.min_max[column * 2 + 1];
            assert!((-1.0..=1.0).contains(&min), "min {min} out of range");
            assert!((-1.0..=1.0).contains(&max), "max {max} out of range");
            assert!(max > 0.7, "column {column} max {max} too quiet");
            assert!(min < -0.7, "column {column} min {min} too quiet");
            assert!((min + max).abs() < 0.05, "column {column} is not symmetric");
        }
    }

    #[test]
    fn short_files_are_chunked_finely_and_long_ones_stay_coarse() {
        assert_eq!(chunk_frames_for(None), CHUNK_FRAMES);
        assert_eq!(chunk_frames_for(Some(0)), CHUNK_FRAMES);
        assert_eq!(chunk_frames_for(Some(u64::from(SAMPLE_RATE) * 600)), CHUNK_FRAMES);
        assert!(chunk_frames_for(Some(u64::from(SAMPLE_RATE) / 2)) < CHUNK_FRAMES);
    }

    #[test]
    fn a_short_file_yields_more_chunks_than_a_wide_view_has_columns() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("short.wav");
        write_tone_wav(&path, 440.0, SAMPLE_RATE, SAMPLE_RATE / 4, 1, 0.8);

        let chunks = exact_chunks(&path).expect("chunks");
        let count = chunks.min_max.len() / 2;

        assert!(chunks.chunk_frames < CHUNK_FRAMES);
        assert!(count >= 4096, "a quarter-second file gave only {count} chunks");
    }

    #[test]
    fn a_short_file_fills_a_wide_view_without_stepping() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("short.wav");
        write_tone_wav(&path, 440.0, SAMPLE_RATE, SAMPLE_RATE / 4, 1, 0.8);

        let columns = 1200;
        let peaks = reduce(&exact_chunks(&path).expect("chunks"), columns);

        let repeated = (1..columns)
            .filter(|column| {
                peaks.min_max[column * 2] == peaks.min_max[(column - 1) * 2]
                    && peaks.min_max[column * 2 + 1] == peaks.min_max[(column - 1) * 2 + 1]
            })
            .count();

        assert!(
            repeated * 10 < columns,
            "{repeated} of {columns} columns repeat the one before â€” the view is a staircase"
        );
    }

    #[test]
    fn the_sampled_pass_does_not_smear_a_short_file_across_columns() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("late.wav");
        write_late_tone_wav(&path, SAMPLE_RATE, SAMPLE_RATE / 4, 1);

        let peaks = sampled_peaks(&path, 64).expect("peaks");

        for column in 0..30 {
            let max = peaks.min_max[column * 2 + 1];
            assert!(max.abs() < 0.05, "column {column} bled from the loud half: {max}");
        }
        assert!(peaks.min_max[63 * 2 + 1] > 0.7);
    }

    #[test]
    fn the_sampled_pass_reads_far_less_than_the_whole_file() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("large.wav");
        let frames = SAMPLE_RATE * 120;
        write_silence_wav(&path, SAMPLE_RATE, frames, 2);
        let size = std::fs::metadata(&path).expect("metadata").len();

        let (mut source, bytes_read) =
            crate::audio::decode::AudioSource::open_counted(&path).expect("open");
        let spec = source.spec();
        let total = spec.frames.expect("frames");
        for column in 0..256u64 {
            source.seek_to_frame(total * column / 256).expect("seek");
            let mut gathered = 0u64;
            while gathered < SAMPLED_FRAMES_PER_COLUMN {
                let Some((_, samples)) = source.next_block().expect("block") else {
                    break;
                };
                gathered += (samples.len() / 2) as u64;
            }
        }

        let read = bytes_read.load(std::sync::atomic::Ordering::Relaxed);
        assert!(size > 20_000_000, "fixture should be large, was {size}");
        assert!(
            read < size / 10,
            "sampled pass read {read} of {size} bytes â€” it is loading the file whole"
        );
    }

    #[test]
    fn the_sampled_and_exact_passes_agree_on_a_small_file() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("tone.wav");
        write_tone_wav(&path, 220.0, SAMPLE_RATE, SAMPLE_RATE / 2, 1, 0.5);

        let sampled = sampled_peaks(&path, 32).expect("sampled");
        let exact = reduce(&exact_chunks(&path).expect("chunks"), 32);

        assert_eq!(sampled.frames, exact.frames);
        assert!(exact.exact);
        for column in 0..32 {
            let sampled_max = sampled.min_max[column * 2 + 1];
            let exact_max = exact.min_max[column * 2 + 1];
            assert!(
                (sampled_max - exact_max).abs() < 0.1,
                "column {column}: sampled {sampled_max} vs exact {exact_max}"
            );
        }
    }

    #[test]
    fn silence_reads_as_a_flat_line_rather_than_infinities() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("silence.wav");
        write_silence_wav(&path, SAMPLE_RATE, 4096, 2);

        let peaks = sampled_peaks(&path, 16).expect("peaks");

        assert!(peaks.min_max.iter().all(|value| value.abs() < 0.001));
        assert!(peaks.min_max.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn a_truncated_file_and_a_garbage_file_both_fail_without_panicking() {
        let dir = TempDir::new().expect("temp dir");

        let truncated = dir.path().join("truncated.wav");
        std::fs::write(&truncated, b"RIFF\x24\x00\x00\x00WAVE").expect("write");
        assert!(sampled_peaks(&truncated, 8).is_err());

        let garbage = dir.path().join("garbage.wav");
        std::fs::write(&garbage, vec![0x5a; 4096]).expect("write");
        assert!(sampled_peaks(&garbage, 8).is_err());

        let missing = dir.path().join("absent.wav");
        assert!(sampled_peaks(&missing, 8).is_err());
    }

    #[test]
    fn reducing_chunks_to_any_column_count_keeps_the_extremes() {
        let chunks = PeakChunks {
            frames: 4096,
            channels: 1,
            sample_rate: SAMPLE_RATE,
            chunk_frames: CHUNK_FRAMES,
            min_max: vec![-0.1, 0.1, -0.9, 0.9, -0.2, 0.2, -0.3, 0.3],
        };

        let wide = reduce(&chunks, 4);
        assert_eq!(
            wide.min_max,
            vec![-0.1, 0.1, -0.9, 0.9, -0.2, 0.2, -0.3, 0.3]
        );

        let narrow = reduce(&chunks, 2);
        assert_eq!(narrow.min_max, vec![-0.9, 0.9, -0.3, 0.3]);

        let single = reduce(&chunks, 1);
        assert_eq!(single.min_max, vec![-0.9, 0.9]);
    }

    #[test]
    fn asking_for_more_columns_than_chunks_never_reads_out_of_bounds() {
        let chunks = PeakChunks {
            frames: 1024,
            channels: 1,
            sample_rate: SAMPLE_RATE,
            chunk_frames: CHUNK_FRAMES,
            min_max: vec![-0.5, 0.5],
        };

        let stretched = reduce(&chunks, 8);

        assert_eq!(stretched.min_max.len(), 16);
        assert!(stretched.min_max.chunks(2).all(|pair| pair == [-0.5, 0.5]));
    }

    #[test]
    fn an_empty_chunk_set_reduces_to_a_flat_line() {
        let chunks = PeakChunks {
            frames: 0,
            channels: 2,
            sample_rate: SAMPLE_RATE,
            chunk_frames: CHUNK_FRAMES,
            min_max: Vec::new(),
        };

        let peaks = reduce(&chunks, 4);

        assert_eq!(peaks.min_max, vec![0.0; 8]);
    }
}


