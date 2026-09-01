use std::io::{BufWriter, Write};
use std::path::Path;

pub fn write_tone_wav(
    path: &Path,
    frequency: f32,
    sample_rate: u32,
    frames: u32,
    channels: u16,
    amplitude: f32,
) {
    write_wav(path, sample_rate, frames, channels, |frame| {
        let phase = frame as f32 / sample_rate as f32 * frequency * std::f32::consts::TAU;
        phase.sin() * amplitude
    });
}

pub fn write_late_tone_wav(path: &Path, sample_rate: u32, frames: u32, channels: u16) {
    write_wav(path, sample_rate, frames, channels, |frame| {
        if frame * 2 < frames {
            return 0.0;
        }
        let phase = frame as f32 / sample_rate as f32 * 440.0 * std::f32::consts::TAU;
        phase.sin() * 0.9
    });
}

pub fn write_silence_wav(path: &Path, sample_rate: u32, frames: u32, channels: u16) {
    write_wav(path, sample_rate, frames, channels, |_frame| 0.0);
}

fn write_wav(
    path: &Path,
    sample_rate: u32,
    frames: u32,
    channels: u16,
    value_at: impl Fn(u32) -> f32,
) {
    write_wav_raw(path, sample_rate, frames, channels, |frame| {
        (value_at(frame).clamp(-1.0, 1.0) * i16::MAX as f32) as i16
    });
}

fn write_wav_raw(
    path: &Path,
    sample_rate: u32,
    frames: u32,
    channels: u16,
    sample_at: impl Fn(u32) -> i16,
) {
    let block_align = channels * 2;
    let data_length = frames * u32::from(block_align);
    let file = std::fs::File::create(path).expect("create wav");
    let mut writer = BufWriter::new(file);

    writer.write_all(b"RIFF").expect("write");
    writer
        .write_all(&(36 + data_length).to_le_bytes())
        .expect("write");
    writer.write_all(b"WAVEfmt ").expect("write");
    writer.write_all(&16u32.to_le_bytes()).expect("write");
    writer.write_all(&1u16.to_le_bytes()).expect("write");
    writer.write_all(&channels.to_le_bytes()).expect("write");
    writer.write_all(&sample_rate.to_le_bytes()).expect("write");
    writer
        .write_all(&(sample_rate * u32::from(block_align)).to_le_bytes())
        .expect("write");
    writer.write_all(&block_align.to_le_bytes()).expect("write");
    writer.write_all(&16u16.to_le_bytes()).expect("write");
    writer.write_all(b"data").expect("write");
    writer.write_all(&data_length.to_le_bytes()).expect("write");

    for frame in 0..frames {
        let sample = sample_at(frame);
        for _channel in 0..channels {
            writer.write_all(&sample.to_le_bytes()).expect("write");
        }
    }

    writer.flush().expect("flush");
}

pub fn write_ramp_wav(path: &Path, sample_rate: u32, frames: u32, channels: u16) {
    write_wav_raw(path, sample_rate, frames, channels, |frame| frame as i16);
}
