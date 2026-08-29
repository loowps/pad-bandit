use std::path::Path;

use crate::audio::decode::{AudioSource, AudioSpec};
use crate::error::Result;

const REVERSE_CHUNK_FRAMES: u64 = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub start: u64,
    pub end: u64,
    pub looping: bool,
    pub reverse: bool,
}

pub struct RegionReader {
    source: AudioSource,
    spec: AudioSpec,
    channels: usize,
    region: Region,
    window: Vec<f32>,
    window_offset: usize,
    cursor: u64,
    position: u64,
    finished: bool,
}

impl RegionReader {
    pub fn open(path: &Path, region: Region) -> Result<Self> {
        Self::from_source(AudioSource::open(path)?, region)
    }

    pub fn from_source(source: AudioSource, region: Region) -> Result<Self> {
        let spec = source.spec();
        let channels = usize::from(spec.channels.max(1));
        let region = clamp_region(region, spec.frames);

        let mut reader = Self {
            source,
            spec,
            channels,
            region,
            window: Vec::new(),
            window_offset: 0,
            cursor: 0,
            position: 0,
            finished: false,
        };
        reader.rewind()?;
        Ok(reader)
    }

    pub fn spec(&self) -> AudioSpec {
        self.spec
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    pub fn region(&self) -> Region {
        self.region
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    pub fn is_finished(&self) -> bool {
        self.finished && self.window_offset >= self.window.len() / self.channels
    }

    pub fn seek(&mut self, frame: u64) -> Result<()> {
        let clamped = frame.clamp(self.region.start, self.region.end);
        self.cursor = if self.region.reverse {
            clamped.max(self.region.start)
        } else {
            clamped
        };
        self.position = self.cursor;
        self.window.clear();
        self.window_offset = 0;
        self.finished = false;
        Ok(())
    }

    pub fn read(&mut self, out: &mut [f32]) -> Result<usize> {
        let wanted = out.len() / self.channels;
        let mut written = 0;

        while written < wanted {
            if self.window_offset >= self.window.len() / self.channels && !self.refill()? {
                break;
            }

            let available = self.window.len() / self.channels - self.window_offset;
            let taking = available.min(wanted - written);
            let from = self.window_offset * self.channels;
            let to = (self.window_offset + taking) * self.channels;

            out[written * self.channels..(written + taking) * self.channels]
                .copy_from_slice(&self.window[from..to]);

            self.window_offset += taking;
            written += taking;
            self.advance_position(taking as u64);
        }

        Ok(written)
    }

    fn advance_position(&mut self, frames: u64) {
        self.position = if self.region.reverse {
            self.position.saturating_sub(frames)
        } else {
            self.position.saturating_add(frames)
        };
    }

    fn rewind(&mut self) -> Result<()> {
        let start = if self.region.reverse {
            self.region.end
        } else {
            self.region.start
        };
        self.seek(start)
    }

    fn refill(&mut self) -> Result<bool> {
        if self.finished {
            return Ok(false);
        }
        if self.region.reverse {
            self.refill_backwards()
        } else {
            self.refill_forwards()
        }
    }

    fn refill_forwards(&mut self) -> Result<bool> {
        if self.cursor >= self.region.end {
            if !self.region.looping {
                self.finished = true;
                return Ok(false);
            }
            self.cursor = self.region.start;
            self.position = self.region.start;
        }

        let wanted = self.cursor;
        self.source.seek_to_frame(wanted)?;

        let Some((timestamp, samples)) = self.source.next_block()? else {
            self.finished = true;
            return Ok(false);
        };

        let channels = self.channels;
        let block_frames = (samples.len() / channels) as u64;
        let skip = wanted.saturating_sub(timestamp).min(block_frames);
        let take = (self.region.end - wanted).min(block_frames - skip);
        if take == 0 {
            self.finished = true;
            return Ok(false);
        }

        let from = (skip as usize) * channels;
        let to = ((skip + take) as usize) * channels;
        self.window.clear();
        self.window.extend_from_slice(&samples[from..to]);
        self.window_offset = 0;
        self.cursor = wanted + take;

        Ok(true)
    }

    fn refill_backwards(&mut self) -> Result<bool> {
        if self.cursor <= self.region.start {
            if !self.region.looping {
                self.finished = true;
                return Ok(false);
            }
            self.cursor = self.region.end;
            self.position = self.region.end;
        }

        let chunk_end = self.cursor;
        let chunk_start = chunk_end
            .saturating_sub(REVERSE_CHUNK_FRAMES)
            .max(self.region.start);
        let frames = (chunk_end - chunk_start) as usize;
        if frames == 0 {
            self.finished = true;
            return Ok(false);
        }

        let channels = self.channels;
        let mut chunk = vec![0.0f32; frames * channels];
        self.read_span_into(chunk_start, &mut chunk)?;

        self.window.clear();
        self.window.reserve(chunk.len());
        for frame in (0..frames).rev() {
            self.window
                .extend_from_slice(&chunk[frame * channels..(frame + 1) * channels]);
        }
        self.window_offset = 0;
        self.cursor = chunk_start;

        Ok(true)
    }

    fn read_span_into(&mut self, start: u64, span: &mut [f32]) -> Result<()> {
        let channels = self.channels;
        let wanted_frames = span.len() / channels;
        self.source.seek_to_frame(start)?;

        let mut filled = 0usize;
        let mut expected = start;
        while filled < wanted_frames {
            let Some((timestamp, samples)) = self.source.next_block()? else {
                break;
            };
            let block_frames = samples.len() / channels;
            let skip = (expected.saturating_sub(timestamp) as usize).min(block_frames);
            let taking = (block_frames - skip).min(wanted_frames - filled);
            if taking == 0 {
                break;
            }

            span[filled * channels..(filled + taking) * channels]
                .copy_from_slice(&samples[skip * channels..(skip + taking) * channels]);
            filled += taking;
            expected += taking as u64;
        }

        Ok(())
    }
}

fn clamp_region(region: Region, frames: Option<u64>) -> Region {
    let total = frames.unwrap_or(u64::MAX);
    let start = region.start.min(total);
    Region {
        start,
        end: region.end.clamp(start, total),
        ..region
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::testing::write_ramp_wav;
    use tempfile::TempDir;

    const SAMPLE_RATE: u32 = 44_100;
    const FRAMES: u32 = 20_000;

    struct Fixture {
        _dir: TempDir,
        path: std::path::PathBuf,
    }

    fn ramp() -> Fixture {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("ramp.wav");
        write_ramp_wav(&path, SAMPLE_RATE, FRAMES, 1);
        Fixture { _dir: dir, path }
    }

    fn region(start: u64, end: u64) -> Region {
        Region {
            start,
            end,
            looping: false,
            reverse: false,
        }
    }

    fn read_all(reader: &mut RegionReader, limit: usize) -> Vec<f32> {
        let mut collected = Vec::new();
        let mut buffer = vec![0.0f32; 512 * reader.channels()];
        while collected.len() < limit {
            let frames = reader.read(&mut buffer).expect("read");
            if frames == 0 {
                break;
            }
            collected.extend_from_slice(&buffer[..frames * reader.channels()]);
        }
        collected
    }

    fn frame_index(value: f32) -> u64 {
        (value * 32_768.0).round() as u64
    }

    #[test]
    fn a_region_yields_only_the_frames_between_its_bounds() {
        let fixture = ramp();
        let mut reader = RegionReader::open(&fixture.path, region(1000, 1500)).expect("open");

        let samples = read_all(&mut reader, 10_000);

        assert_eq!(samples.len(), 500);
        assert_eq!(frame_index(samples[0]), 1000);
        assert_eq!(frame_index(samples[499]), 1499);
        assert!(reader.is_finished());
    }

    #[test]
    fn a_region_that_is_not_looping_stops_at_its_end() {
        let fixture = ramp();
        let mut reader = RegionReader::open(&fixture.path, region(0, 100)).expect("open");

        let samples = read_all(&mut reader, 10_000);

        assert_eq!(samples.len(), 100);
        assert_eq!(reader.position(), 100);
    }

    #[test]
    fn a_looping_region_wraps_back_to_its_start_frame() {
        let fixture = ramp();
        let mut reader = RegionReader::open(
            &fixture.path,
            Region {
                looping: true,
                ..region(1000, 1100)
            },
        )
        .expect("open");

        let samples = read_all(&mut reader, 250);

        assert!(samples.len() >= 250);
        assert_eq!(frame_index(samples[0]), 1000);
        assert_eq!(frame_index(samples[99]), 1099);
        assert_eq!(
            frame_index(samples[100]),
            1000,
            "the loop restarts at start"
        );
        assert_eq!(frame_index(samples[199]), 1099);
        assert_eq!(frame_index(samples[200]), 1000);
    }

    #[test]
    fn a_reversed_region_reads_backwards_from_its_end() {
        let fixture = ramp();
        let mut reader = RegionReader::open(
            &fixture.path,
            Region {
                reverse: true,
                ..region(1000, 1500)
            },
        )
        .expect("open");

        let samples = read_all(&mut reader, 10_000);

        assert_eq!(samples.len(), 500);
        assert_eq!(frame_index(samples[0]), 1499);
        assert_eq!(frame_index(samples[1]), 1498);
        assert_eq!(frame_index(samples[499]), 1000);
    }

    #[test]
    fn a_reversed_loop_wraps_back_to_its_end_frame() {
        let fixture = ramp();
        let mut reader = RegionReader::open(
            &fixture.path,
            Region {
                looping: true,
                reverse: true,
                ..region(1000, 1100)
            },
        )
        .expect("open");

        let samples = read_all(&mut reader, 250);

        assert_eq!(frame_index(samples[0]), 1099);
        assert_eq!(frame_index(samples[99]), 1000);
        assert_eq!(frame_index(samples[100]), 1099);
    }

    #[test]
    fn a_region_longer_than_one_decoded_block_stays_contiguous() {
        let fixture = ramp();
        let mut reader = RegionReader::open(&fixture.path, region(0, FRAMES.into())).expect("open");

        let samples = read_all(&mut reader, FRAMES as usize + 10);

        assert_eq!(samples.len(), FRAMES as usize);
        for (index, value) in samples.iter().enumerate() {
            assert_eq!(
                frame_index(*value),
                index as u64,
                "frame {index} is out of order"
            );
        }
    }

    #[test]
    fn seeking_moves_the_next_read_and_the_reported_position() {
        let fixture = ramp();
        let mut reader = RegionReader::open(&fixture.path, region(0, FRAMES.into())).expect("open");
        let mut buffer = vec![0.0f32; 16];

        reader.seek(12_345).expect("seek");
        assert_eq!(reader.position(), 12_345);
        reader.read(&mut buffer).expect("read");

        assert_eq!(frame_index(buffer[0]), 12_345);
        assert_eq!(reader.position(), 12_345 + 16);
    }

    #[test]
    fn seeking_is_clamped_to_the_region() {
        let fixture = ramp();
        let mut reader = RegionReader::open(&fixture.path, region(1000, 2000)).expect("open");

        reader.seek(0).expect("seek");
        assert_eq!(reader.position(), 1000);

        reader.seek(99_999).expect("seek");
        assert_eq!(reader.position(), 2000);
    }

    #[test]
    fn seeking_a_large_file_does_not_read_it_from_the_beginning() {
        let dir = TempDir::new().expect("temp dir");
        let path = dir.path().join("large.wav");
        let frames = SAMPLE_RATE * 120;
        write_ramp_wav(&path, SAMPLE_RATE, frames, 2);
        let size = std::fs::metadata(&path).expect("metadata").len();

        let (source, bytes_read) = AudioSource::open_counted(&path).expect("open");
        let mut reader =
            RegionReader::from_source(source, region(0, frames.into())).expect("region");
        let opened = bytes_read.load(std::sync::atomic::Ordering::Relaxed);

        reader.seek(u64::from(frames) - 1000).expect("seek");
        let mut buffer = vec![0.0f32; 512 * 2];
        reader.read(&mut buffer).expect("read");

        let read = bytes_read.load(std::sync::atomic::Ordering::Relaxed) - opened;
        assert!(size > 20_000_000, "fixture should be large, was {size}");
        assert!(
            read < 1_000_000,
            "seeking to the end read {read} bytes — it is scanning the file"
        );
    }

    #[test]
    fn an_empty_region_produces_no_audio_rather_than_looping_forever() {
        let fixture = ramp();
        let mut reader = RegionReader::open(
            &fixture.path,
            Region {
                looping: true,
                ..region(500, 500)
            },
        )
        .expect("open");

        let samples = read_all(&mut reader, 1000);

        assert!(samples.is_empty());
        assert!(reader.is_finished());
    }

    #[test]
    fn a_region_beyond_the_file_is_clamped_to_what_exists() {
        let fixture = ramp();
        let mut reader = RegionReader::open(&fixture.path, region(0, 999_999)).expect("open");

        let samples = read_all(&mut reader, FRAMES as usize + 100);

        assert_eq!(samples.len(), FRAMES as usize);
    }
}
