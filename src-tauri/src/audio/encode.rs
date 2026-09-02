use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

use crate::audio::decode::AudioSource;
use crate::audio::resample::RateConverter;
use crate::card::AUDIO_DATA_OFFSET;
use crate::error::{Error, Result};

pub const CARD_SAMPLE_RATE: u32 = 44_100;
pub const CARD_BITS_PER_SAMPLE: u16 = 16;
const CARD_MAX_CHANNELS: u16 = 2;
const RLND_CHUNK_SIZE: u32 = 458;
const FMT_CHUNK_SIZE: u32 = 18;
const ROLAND_CONSTANT: u32 = 4;
const BLOCK_FRAMES: usize = 8_192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CardSample {
    pub channels: u16,
    pub frames: u64,
    pub bytes: u64,
    pub source_rate: u32,
}

impl CardSample {
    fn of(channels: u16, frames: u64, source_rate: u32) -> Self {
        Self {
            channels,
            frames,
            bytes: u64::from(AUDIO_DATA_OFFSET) + frames * u64::from(block_align(channels)),
            source_rate,
        }
    }
}

pub fn block_align(channels: u16) -> u16 {
    channels * (CARD_BITS_PER_SAMPLE / 8)
}

pub fn card_channels(source_channels: u16) -> u16 {
    source_channels.clamp(1, CARD_MAX_CHANNELS)
}

pub fn estimate(path: &Path) -> Result<CardSample> {
    let spec = AudioSource::open(path)?.spec();
    let frames = spec
        .frames
        .ok_or_else(|| Error::Audio(format!("{} does not declare a length", path.display())))?;

    Ok(CardSample::of(
        card_channels(spec.channels),
        resampled_frames(frames, spec.sample_rate),
        spec.sample_rate,
    ))
}

pub fn resampled_frames(frames: u64, from_rate: u32) -> u64 {
    if from_rate == CARD_SAMPLE_RATE {
        return frames;
    }
    (frames as u128 * u128::from(CARD_SAMPLE_RATE) / u128::from(from_rate)) as u64
}

pub fn encode_to_card(source: &Path, destination: &Path, slot: u8) -> Result<CardSample> {
    let mut reader = AudioSource::open(source)?;
    let spec = reader.spec();
    let channels = card_channels(spec.channels);

    let file = File::create(destination)?;
    let mut writer = BufWriter::new(file);
    writer.write_all(&[0u8; AUDIO_DATA_OFFSET as usize])?;

    let mut converter = (spec.sample_rate != CARD_SAMPLE_RATE)
        .then(|| RateConverter::new(spec.sample_rate, CARD_SAMPLE_RATE, usize::from(channels)))
        .transpose()?;

    let mut mixed: Vec<f32> = Vec::with_capacity(BLOCK_FRAMES * usize::from(channels));
    let mut resampled: Vec<f32> = Vec::new();
    let mut frames: u64 = 0;

    while let Some((_, block)) = reader.next_block()? {
        downmix(block, spec.channels, channels, &mut mixed);
        frames += write_samples(&mut writer, &mut converter, &mixed, &mut resampled, channels)?;
    }

    if let Some(converter) = converter.as_mut() {
        resampled.clear();
        converter.flush(&mut resampled)?;
        frames += write_pcm(&mut writer, &resampled, channels)?;
    }

    let sample = CardSample::of(channels, frames, spec.sample_rate);
    write_header(&mut writer, slot, &sample)?;
    writer.flush()?;
    writer.into_inner().map_err(|error| Error::Audio(error.to_string()))?.sync_all()?;

    Ok(sample)
}

fn write_samples(
    writer: &mut BufWriter<File>,
    converter: &mut Option<RateConverter>,
    mixed: &[f32],
    resampled: &mut Vec<f32>,
    channels: u16,
) -> Result<u64> {
    match converter {
        Some(converter) => {
            resampled.clear();
            converter.convert(mixed, resampled)?;
            write_pcm(writer, resampled, channels)
        }
        None => write_pcm(writer, mixed, channels),
    }
}

fn write_pcm(writer: &mut BufWriter<File>, interleaved: &[f32], channels: u16) -> Result<u64> {
    let mut bytes = Vec::with_capacity(interleaved.len() * 2);
    for sample in interleaved {
        bytes.extend_from_slice(&to_i16(*sample).to_le_bytes());
    }
    writer.write_all(&bytes)?;

    Ok(interleaved.len() as u64 / u64::from(channels))
}

fn to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

fn downmix(block: &[f32], from: u16, to: u16, out: &mut Vec<f32>) {
    out.clear();
    if from == to {
        out.extend_from_slice(block);
        return;
    }

    let from = usize::from(from);
    for frame in block.chunks_exact(from) {
        match to {
            1 => out.push(frame.iter().sum::<f32>() / from as f32),
            _ => {
                let (left, right) = frame.split_at(from.div_ceil(2));
                out.push(left.iter().sum::<f32>() / left.len() as f32);
                out.push(right.iter().sum::<f32>() / right.len() as f32);
            }
        }
    }
}

fn write_header(writer: &mut BufWriter<File>, slot: u8, sample: &CardSample) -> Result<()> {
    let channels = sample.channels;
    let block_align = block_align(channels);
    let data_bytes = (sample.bytes - u64::from(AUDIO_DATA_OFFSET)) as u32;
    let mut header = Vec::with_capacity(AUDIO_DATA_OFFSET as usize);

    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&((sample.bytes - 8) as u32).to_le_bytes());
    header.extend_from_slice(b"WAVE");

    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&FMT_CHUNK_SIZE.to_le_bytes());
    header.extend_from_slice(&1u16.to_le_bytes());
    header.extend_from_slice(&channels.to_le_bytes());
    header.extend_from_slice(&CARD_SAMPLE_RATE.to_le_bytes());
    header.extend_from_slice(&(CARD_SAMPLE_RATE * u32::from(block_align)).to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&CARD_BITS_PER_SAMPLE.to_le_bytes());
    header.extend_from_slice(&0u16.to_le_bytes());

    header.extend_from_slice(b"RLND");
    header.extend_from_slice(&RLND_CHUNK_SIZE.to_le_bytes());
    header.extend_from_slice(b"roifspsx");
    header.extend_from_slice(&ROLAND_CONSTANT.to_le_bytes());
    header.extend_from_slice(&u32::from(slot).to_le_bytes());
    header.resize(AUDIO_DATA_OFFSET as usize - 8, 0);

    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_bytes.to_le_bytes());

    writer.flush()?;
    let file = writer.get_mut();
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&header)?;
    file.seek(SeekFrom::End(0))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::testing;
    use tempfile::TempDir;

    const GOLDEN_HEADER: &[u8] = include_bytes!("../../tests/fixtures/A0000001.header512.bin");

    struct Encoded {
        _dir: TempDir,
        bytes: Vec<u8>,
        sample: CardSample,
    }

    fn encode_silence(rate: u32, channels: u16, frames: u32, slot: u8) -> Encoded {
        let dir = TempDir::new().expect("temp dir");
        let source = dir.path().join("source.wav");
        testing::write_silence_wav(&source, rate, frames, channels);

        let destination = dir.path().join("A0000001.WAV");
        let sample = encode_to_card(&source, &destination, slot).expect("encode");
        let bytes = std::fs::read(&destination).expect("read back");

        Encoded {
            _dir: dir,
            bytes,
            sample,
        }
    }

    fn le_u16(bytes: &[u8], at: usize) -> u16 {
        u16::from_le_bytes(bytes[at..at + 2].try_into().expect("u16"))
    }

    fn le_u32(bytes: &[u8], at: usize) -> u32 {
        u32::from_le_bytes(bytes[at..at + 4].try_into().expect("u32"))
    }

    #[test]
    fn the_header_matches_the_layout_measured_off_a_real_card() {
        let encoded = encode_silence(CARD_SAMPLE_RATE, 2, 1_000, 0);
        let bytes = &encoded.bytes;

        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[12..16], b"fmt ");
        assert_eq!(le_u32(bytes, 16), 18);
        assert_eq!(&bytes[38..42], b"RLND");
        assert_eq!(le_u32(bytes, 42), 458);
        assert_eq!(&bytes[46..54], b"roifspsx");
        assert_eq!(le_u32(bytes, 54), 4);
        assert_eq!(&bytes[504..508], b"data");
    }

    #[test]
    fn a_stereo_encode_reproduces_the_golden_header_apart_from_its_sizes() {
        let encoded = encode_silence(CARD_SAMPLE_RATE, 2, 1_000, 0);

        assert_eq!(encoded.bytes[20..38], GOLDEN_HEADER[20..38], "fmt body");
        assert_eq!(encoded.bytes[38..62], GOLDEN_HEADER[38..62], "Roland chunk and index");
        assert_eq!(encoded.bytes[62..504], GOLDEN_HEADER[62..504], "padding");
        assert_eq!(encoded.bytes[504..508], GOLDEN_HEADER[504..508]);
    }

    #[test]
    fn the_sample_index_is_written_as_a_little_endian_u32() {
        for slot in [0u8, 7, 73, 119] {
            let encoded = encode_silence(CARD_SAMPLE_RATE, 2, 64, slot);

            assert_eq!(&encoded.bytes[58..62], &u32::from(slot).to_le_bytes());
            assert_eq!(encoded.bytes[58], slot);
        }
    }

    #[test]
    fn audio_always_begins_at_byte_512_and_every_size_agrees() {
        for (channels, frames) in [(1u16, 1_000u32), (2, 1_000), (2, 1)] {
            let encoded = encode_silence(CARD_SAMPLE_RATE, channels, frames, 0);
            let bytes = &encoded.bytes;

            assert_eq!(le_u32(bytes, 4) as usize + 8, bytes.len());
            assert_eq!(le_u32(bytes, 508) as usize, bytes.len() - 512);
            assert_eq!(
                le_u32(bytes, 508),
                frames * u32::from(block_align(channels))
            );
            assert_eq!(encoded.sample.bytes as usize, bytes.len());
            assert_eq!(encoded.sample.frames, u64::from(frames));
        }
    }

    #[test]
    fn a_mono_source_stays_mono_on_the_card() {
        let encoded = encode_silence(CARD_SAMPLE_RATE, 1, 500, 0);

        assert_eq!(le_u16(&encoded.bytes, 22), 1);
        assert_eq!(le_u16(&encoded.bytes, 32), 2, "blockAlign");
        assert_eq!(encoded.bytes.len(), 512 + 500 * 2);
    }

    #[test]
    fn more_than_two_channels_are_folded_down_to_stereo() {
        let encoded = encode_silence(CARD_SAMPLE_RATE, 6, 300, 0);

        assert_eq!(le_u16(&encoded.bytes, 22), 2);
        assert_eq!(encoded.bytes.len(), 512 + 300 * 4);
    }

    #[test]
    fn a_source_at_another_rate_is_resampled_to_the_cards_rate() {
        let encoded = encode_silence(48_000, 2, 48_000, 0);

        assert_eq!(le_u32(&encoded.bytes, 24), CARD_SAMPLE_RATE);
        let drift = encoded.sample.frames.abs_diff(u64::from(CARD_SAMPLE_RATE));
        assert!(drift < 2_000, "{} frames is not near 44100", encoded.sample.frames);
    }

    #[test]
    fn the_estimate_is_exact_when_no_resampling_is_needed() {
        let dir = TempDir::new().expect("temp dir");
        let source = dir.path().join("source.wav");
        testing::write_silence_wav(&source, CARD_SAMPLE_RATE, 5_000, 2);

        let estimated = estimate(&source).expect("estimate");
        let written = encode_to_card(&source, &dir.path().join("out.wav"), 0).expect("encode");

        assert_eq!(estimated, written);
    }

    #[test]
    fn the_estimate_is_close_enough_to_budget_a_resampled_source() {
        let dir = TempDir::new().expect("temp dir");
        let source = dir.path().join("source.wav");
        testing::write_silence_wav(&source, 48_000, 48_000, 2);

        let estimated = estimate(&source).expect("estimate");
        let written = encode_to_card(&source, &dir.path().join("out.wav"), 0).expect("encode");

        assert_eq!(estimated.channels, written.channels);
        assert!(estimated.frames.abs_diff(written.frames) < 2_000);
    }

    #[test]
    fn a_full_scale_source_never_wraps_around_to_the_opposite_sign() {
        let dir = TempDir::new().expect("temp dir");
        let source = dir.path().join("loud.wav");
        testing::write_tone_wav(&source, 1_000.0, CARD_SAMPLE_RATE, 4_410, 1, 1.0);

        encode_to_card(&source, &dir.path().join("out.wav"), 0).expect("encode");
        let bytes = std::fs::read(dir.path().join("out.wav")).expect("read");
        let samples: Vec<i16> = bytes[512..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| i16::from_le_bytes(*pair))
            .collect();

        assert!(samples.iter().any(|value| value.abs() > 30_000), "not loud");
        assert!(samples.iter().all(|value| *value != i16::MIN));
    }

    #[test]
    fn a_ramp_survives_the_round_trip_sample_for_sample() {
        let dir = TempDir::new().expect("temp dir");
        let source = dir.path().join("ramp.wav");
        testing::write_ramp_wav(&source, CARD_SAMPLE_RATE, 2_000, 1);

        encode_to_card(&source, &dir.path().join("out.wav"), 0).expect("encode");
        let bytes = std::fs::read(dir.path().join("out.wav")).expect("read");
        let samples: Vec<i16> = bytes[512..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| i16::from_le_bytes(*pair))
            .collect();

        assert_eq!(samples.len(), 2_000);
        for (frame, sample) in samples.iter().enumerate() {
            assert!(
                sample.abs_diff(frame as i16) <= 1,
                "frame {frame} came back as {sample}"
            );
        }
    }
}
