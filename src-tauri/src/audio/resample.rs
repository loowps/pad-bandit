use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Async, FixedAsync, Indexing, PolynomialDegree, Resampler};

use crate::error::{Error, Result};

const CHUNK_FRAMES: usize = 1024;

pub struct RateConverter {
    resampler: Async<f32>,
    channels: usize,
    input: Vec<f32>,
    output: Vec<f32>,
    pending: usize,
}

impl RateConverter {
    pub fn new(from_rate: u32, to_rate: u32, channels: usize) -> Result<Self> {
        let resampler = Async::<f32>::new_poly(
            f64::from(to_rate) / f64::from(from_rate),
            1.0,
            PolynomialDegree::Cubic,
            CHUNK_FRAMES,
            channels,
            FixedAsync::Input,
        )
        .map_err(|error| Error::Audio(format!("could not open a resampler: {error}")))?;

        let output = vec![0.0; resampler.output_frames_max() * channels];

        Ok(Self {
            resampler,
            channels,
            input: vec![0.0; CHUNK_FRAMES * channels],
            output,
            pending: 0,
        })
    }

    pub fn convert(&mut self, interleaved: &[f32], out: &mut Vec<f32>) -> Result<()> {
        for frame in interleaved.chunks_exact(self.channels) {
            let offset = self.pending * self.channels;
            self.input[offset..offset + self.channels].copy_from_slice(frame);
            self.pending += 1;

            if self.pending == CHUNK_FRAMES {
                self.process(out, None)?;
            }
        }
        Ok(())
    }

    pub fn flush(&mut self, out: &mut Vec<f32>) -> Result<()> {
        if self.pending == 0 {
            return Ok(());
        }
        let partial = self.pending;
        self.input[partial * self.channels..].fill(0.0);
        self.process(out, Some(partial))
    }

    fn process(&mut self, out: &mut Vec<f32>, partial_len: Option<usize>) -> Result<()> {
        let source = InterleavedSlice::new(&self.input, self.channels, CHUNK_FRAMES)
            .map_err(adapter_error)?;
        let frames_out = self.output.len() / self.channels;
        let mut sink = InterleavedSlice::new_mut(&mut self.output, self.channels, frames_out)
            .map_err(adapter_error)?;

        let indexing = Indexing {
            partial_len,
            ..Default::default()
        };
        let (_, produced) = self
            .resampler
            .process_into_buffer(&source, &mut sink, Some(&indexing))
            .map_err(|error| Error::Audio(format!("resampling failed: {error}")))?;

        out.extend_from_slice(&self.output[..produced * self.channels]);
        self.pending = 0;
        Ok(())
    }
}

fn adapter_error(error: impl std::fmt::Display) -> Error {
    Error::Audio(format!("could not wrap the resampler buffers: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(frames: usize, channels: usize, rate: u32, frequency: f32) -> Vec<f32> {
        let mut samples = Vec::with_capacity(frames * channels);
        for frame in 0..frames {
            let phase = frame as f32 / rate as f32 * frequency * std::f32::consts::TAU;
            for _channel in 0..channels {
                samples.push(phase.sin() * 0.5);
            }
        }
        samples
    }

    #[test]
    fn upsampling_produces_roughly_the_expected_number_of_frames() {
        let mut converter = RateConverter::new(44_100, 48_000, 2).expect("converter");
        let input = tone(44_100, 2, 44_100, 440.0);
        let mut output = Vec::new();

        converter.convert(&input, &mut output).expect("convert");

        let frames = output.len() / 2;
        let expected = 48_000.0;
        assert!(
            (frames as f32 - expected).abs() < expected * 0.02,
            "got {frames} frames, expected about {expected}"
        );
    }

    #[test]
    fn downsampling_produces_roughly_the_expected_number_of_frames() {
        let mut converter = RateConverter::new(48_000, 44_100, 1).expect("converter");
        let input = tone(48_000, 1, 48_000, 220.0);
        let mut output = Vec::new();

        converter.convert(&input, &mut output).expect("convert");

        let frames = output.len();
        let expected = 44_100.0;
        assert!(
            (frames as f32 - expected).abs() < expected * 0.02,
            "got {frames} frames, expected about {expected}"
        );
    }

    #[test]
    fn the_converted_signal_keeps_its_amplitude_and_stays_finite() {
        let mut converter = RateConverter::new(44_100, 48_000, 1).expect("converter");
        let input = tone(44_100, 1, 44_100, 440.0);
        let mut output = Vec::new();

        converter.convert(&input, &mut output).expect("convert");

        let peak = output
            .iter()
            .fold(0.0f32, |peak, value| peak.max(value.abs()));
        assert!(output.iter().all(|value| value.is_finite()));
        assert!((peak - 0.5).abs() < 0.05, "peak drifted to {peak}");
    }

    #[test]
    fn a_partial_chunk_is_only_emitted_once_flushed() {
        let mut converter = RateConverter::new(44_100, 48_000, 2).expect("converter");
        let mut output = Vec::new();

        converter
            .convert(&tone(100, 2, 44_100, 440.0), &mut output)
            .expect("convert");
        assert!(output.is_empty());

        converter.flush(&mut output).expect("flush");
        assert!(!output.is_empty());
    }
}
