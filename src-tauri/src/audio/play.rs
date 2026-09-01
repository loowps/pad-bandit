use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Consumer, Producer, RingBuffer};
use serde::Deserialize;

use crate::audio::region::{Region, RegionReader};
use crate::audio::resample::RateConverter;
use crate::error::{Error, Result};

const RING_SECONDS: usize = 1;
const FEED_FRAMES: usize = 4096;
const POSITION_INTERVAL: Duration = Duration::from_millis(100);
const CONVERTER_SLACK_FRAMES: u64 = 64;
const GAIN_RAMP_SECONDS: f32 = 0.005;
const IDLE_POLL: Duration = Duration::from_millis(20);
const BUSY_POLL: Duration = Duration::from_millis(2);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    pub path: PathBuf,
    pub start_frame: u64,
    pub end_frame: u64,
    #[serde(default)]
    pub looping: bool,
    #[serde(default)]
    pub reverse: bool,
    pub gain: f32,
}

pub trait PlaybackEvents: Send + 'static {
    fn position(&self, frame: u64);
    fn ended(&self);
    fn error(&self, message: String);
}

enum Command {
    Play(Box<RegionReader>, f32),
    Stop,
    SetGain(f32),
    Seek(u64),
}

struct Shared {
    gain_bits: AtomicU32,
    consumed: AtomicU64,
    reset: AtomicU64,
    reset_done: AtomicU64,
}

impl Shared {
    fn new() -> Self {
        Self {
            gain_bits: AtomicU32::new(1.0f32.to_bits()),
            consumed: AtomicU64::new(0),
            reset: AtomicU64::new(0),
            reset_done: AtomicU64::new(0),
        }
    }
}

pub struct Player {
    commands: Sender<Command>,
}

impl Player {
    pub fn spawn(events: impl PlaybackEvents) -> Self {
        let (commands, inbox) = channel();
        std::thread::Builder::new()
            .name("pad-bandit-audio".into())
            .spawn(move || run(inbox, events))
            .expect("spawn the audio thread");

        Self { commands }
    }

    pub fn play(&self, request: &PlayRequest) -> Result<()> {
        let reader = RegionReader::open(
            &request.path,
            Region {
                start: request.start_frame,
                end: request.end_frame,
                looping: request.looping,
                reverse: request.reverse,
            },
        )?;

        self.send(Command::Play(
            Box::new(reader),
            request.gain.clamp(0.0, 4.0),
        ))
    }

    pub fn stop(&self) -> Result<()> {
        self.send(Command::Stop)
    }

    pub fn set_gain(&self, gain: f32) -> Result<()> {
        self.send(Command::SetGain(gain.clamp(0.0, 4.0)))
    }

    pub fn seek(&self, frame: u64) -> Result<()> {
        self.send(Command::Seek(frame))
    }

    fn send(&self, command: Command) -> Result<()> {
        self.commands
            .send(command)
            .map_err(|_| Error::Audio("the audio thread is no longer running".into()))
    }
}

struct Output {
    _stream: cpal::Stream,
    producer: Producer<f32>,
    shared: Arc<Shared>,
    channels: usize,
    sample_rate: u32,
}

struct Active {
    reader: RegionReader,
    converter: Option<RateConverter>,
    marks: VecDeque<(u64, u64)>,
    pushed: u64,
    scratch: Vec<f32>,
    staged: Vec<f32>,
    drained: bool,
    needed_slots: usize,
    source_per_output: f64,
}

fn needed_slots(source_rate: u32, device_rate: u32, channels: usize) -> usize {
    let frames = (FEED_FRAMES as u64 * u64::from(device_rate.max(1)))
        .div_ceil(u64::from(source_rate.max(1)))
        + CONVERTER_SLACK_FRAMES;
    frames as usize * channels
}

fn interpolated(mark: (u64, u64), consumed: u64, source_per_output: f64, region: Region) -> u64 {
    let (output_frame, source_frame) = mark;
    let ahead = ((consumed.saturating_sub(output_frame)) as f64 * source_per_output) as u64;

    if region.reverse {
        source_frame.saturating_sub(ahead).max(region.start)
    } else {
        source_frame.saturating_add(ahead).min(region.end)
    }
}

fn run(inbox: Receiver<Command>, events: impl PlaybackEvents) {
    let mut output: Option<Output> = None;
    let mut active: Option<Active> = None;
    let mut last_position = Instant::now();

    loop {
        let wait = if active.is_some() {
            BUSY_POLL
        } else {
            IDLE_POLL
        };
        match inbox.recv_timeout(wait) {
            Ok(command) => {
                if let Err(error) = apply(command, &mut output, &mut active) {
                    active = None;
                    events.error(error.to_string());
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        let Some(output) = output.as_mut() else {
            continue;
        };

        if let Some(current) = active.as_mut() {
            match feed(current, output) {
                Ok(()) => {}
                Err(error) => {
                    active = None;
                    stop_output(output);
                    events.error(error.to_string());
                    continue;
                }
            }

            let consumed = output.shared.consumed.load(Ordering::Relaxed);
            if last_position.elapsed() >= POSITION_INTERVAL {
                last_position = Instant::now();
                if let Some(frame) = source_frame_at(current, consumed) {
                    events.position(frame);
                }
            }

            if current.drained && consumed >= current.pushed {
                active = None;
                events.ended();
            }
        }
    }
}

fn apply(command: Command, output: &mut Option<Output>, active: &mut Option<Active>) -> Result<()> {
    match command {
        Command::Play(reader, gain) => {
            let device = match output.as_mut() {
                Some(existing) => existing,
                None => output.insert(open_output()?),
            };
            reset_output(device);
            device
                .shared
                .gain_bits
                .store(gain.to_bits(), Ordering::Relaxed);

            let source_rate = reader.spec().sample_rate;
            let converter = if source_rate == device.sample_rate {
                None
            } else {
                Some(RateConverter::new(
                    source_rate,
                    device.sample_rate,
                    reader.channels(),
                )?)
            };

            let channels = reader.channels();
            *active = Some(Active {
                reader: *reader,
                converter,
                marks: VecDeque::new(),
                pushed: 0,
                scratch: vec![0.0; FEED_FRAMES * channels],
                staged: Vec::with_capacity(FEED_FRAMES * channels),
                drained: false,
                needed_slots: needed_slots(source_rate, device.sample_rate, device.channels),
                source_per_output: f64::from(source_rate) / f64::from(device.sample_rate.max(1)),
            });
        }
        Command::Stop => {
            *active = None;
            if let Some(device) = output.as_mut() {
                stop_output(device);
            }
        }
        Command::SetGain(gain) => {
            if let Some(device) = output.as_ref() {
                device
                    .shared
                    .gain_bits
                    .store(gain.to_bits(), Ordering::Relaxed);
            }
        }
        Command::Seek(frame) => {
            if let Some(current) = active.as_mut()
                && let Some(device) = output.as_mut()
            {
                current.reader.seek(frame)?;
                current.marks.clear();
                current.pushed = 0;
                current.drained = false;
                reset_output(device);
            }
        }
    }
    Ok(())
}

fn stop_output(output: &mut Output) {
    reset_output(output);
}

fn reset_output(output: &mut Output) {
    let generation = output.shared.reset.fetch_add(1, Ordering::AcqRel) + 1;
    output.shared.consumed.store(0, Ordering::Relaxed);

    let deadline = Instant::now() + Duration::from_millis(200);
    while output.shared.reset_done.load(Ordering::Acquire) < generation && Instant::now() < deadline
    {
        std::thread::yield_now();
    }
}

fn feed(active: &mut Active, output: &mut Output) -> Result<()> {
    while output.producer.slots() >= active.needed_slots {
        if active.drained {
            return Ok(());
        }

        let source_frame = active.reader.position();
        let frames = active.reader.read(&mut active.scratch)?;
        if frames == 0 {
            if let Some(converter) = active.converter.as_mut() {
                active.staged.clear();
                converter.flush(&mut active.staged)?;
                push(active, output, source_frame);
            }
            active.drained = true;
            return Ok(());
        }

        let read = &active.scratch[..frames * active.reader.channels()];
        active.staged.clear();
        match active.converter.as_mut() {
            Some(converter) => converter.convert(read, &mut active.staged)?,
            None => active.staged.extend_from_slice(read),
        }
        push(active, output, source_frame);
    }

    Ok(())
}

fn push(active: &mut Active, output: &mut Output, source_frame: u64) {
    let source_channels = active.reader.channels();
    if active.staged.is_empty() {
        return;
    }

    active.marks.push_back((active.pushed, source_frame));
    while active.marks.len() > 512 {
        active.marks.pop_front();
    }

    let mut pushed_frames = 0u64;
    for frame in active.staged.chunks_exact(source_channels) {
        for channel in 0..output.channels {
            let value = mixed(frame, source_channels, channel, output.channels);
            if output.producer.push(value).is_err() {
                return;
            }
        }
        pushed_frames += 1;
    }
    active.pushed += pushed_frames;
}

fn mixed(frame: &[f32], source_channels: usize, channel: usize, device_channels: usize) -> f32 {
    if source_channels == 1 {
        return frame[0];
    }
    if device_channels == 1 {
        return frame.iter().sum::<f32>() / source_channels as f32;
    }
    frame.get(channel).copied().unwrap_or(0.0)
}

fn source_frame_at(active: &Active, consumed: u64) -> Option<u64> {
    active
        .marks
        .iter()
        .rev()
        .find(|(output_frame, _)| *output_frame <= consumed)
        .map(|mark| interpolated(*mark, consumed, active.source_per_output, active.reader.region()))
}

fn open_output() -> Result<Output> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| Error::Audio("no audio output device is available".into()))?;
    let config = device
        .default_output_config()
        .map_err(|error| Error::Audio(format!("no usable output configuration: {error}")))?;

    let channels = usize::from(config.channels());
    let sample_rate = config.sample_rate();
    let (producer, consumer) =
        RingBuffer::<f32>::new(sample_rate as usize * channels * RING_SECONDS);
    let shared = Arc::new(Shared::new());

    let stream = build_stream(&device, &config, consumer, Arc::clone(&shared), channels)?;
    stream
        .play()
        .map_err(|error| Error::Audio(format!("could not start audio output: {error}")))?;

    Ok(Output {
        _stream: stream,
        producer,
        shared,
        channels,
        sample_rate,
    })
}

fn build_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    consumer: Consumer<f32>,
    shared: Arc<Shared>,
    channels: usize,
) -> Result<cpal::Stream> {
    let stream_config: cpal::StreamConfig = config.config();
    let sample_rate = config.sample_rate();
    let errors = |error| eprintln!("audio output error: {error}");

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let mut drain = Drain::new(consumer, shared, channels, sample_rate);
            device.build_output_stream(
                stream_config,
                move |output: &mut [f32], _: &cpal::OutputCallbackInfo| drain.fill(output),
                errors,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let mut drain = Drain::new(consumer, shared, channels, sample_rate);
            device.build_output_stream(
                stream_config,
                move |output: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    drain.fill_with(output, |value| (value.clamp(-1.0, 1.0) * 32767.0) as i16)
                },
                errors,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let mut drain = Drain::new(consumer, shared, channels, sample_rate);
            device.build_output_stream(
                stream_config,
                move |output: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    drain.fill_with(output, |value| {
                        ((value.clamp(-1.0, 1.0) * 32767.0) as i32 + 32768) as u16
                    })
                },
                errors,
                None,
            )
        }
        format => {
            return Err(Error::Audio(format!(
                "the audio device wants an unsupported sample format ({format})"
            )));
        }
    };

    stream.map_err(|error| Error::Audio(format!("could not open audio output: {error}")))
}

struct Drain {
    consumer: Consumer<f32>,
    shared: Arc<Shared>,
    channels: usize,
    seen_reset: u64,
    gain: f32,
    ramp: f32,
}

impl Drain {
    fn new(consumer: Consumer<f32>, shared: Arc<Shared>, channels: usize, sample_rate: u32) -> Self {
        Self {
            consumer,
            shared,
            channels,
            seen_reset: 0,
            gain: 0.0,
            ramp: 1.0 / (GAIN_RAMP_SECONDS * sample_rate.max(1) as f32),
        }
    }

    fn fill(&mut self, output: &mut [f32]) {
        self.fill_with(output, |value| value)
    }

    fn fill_with<S: Copy>(&mut self, output: &mut [S], convert: impl Fn(f32) -> S) {
        let wanted = self.shared.reset.load(Ordering::Acquire);
        if wanted != self.seen_reset {
            while self.consumer.pop().is_ok() {}
            self.seen_reset = wanted;
            self.gain = 0.0;
            self.shared.reset_done.store(wanted, Ordering::Release);
        }

        let target = f32::from_bits(self.shared.gain_bits.load(Ordering::Relaxed));
        let silence = convert(0.0);
        let mut written = 0;

        while written < output.len() {
            match self.consumer.pop() {
                Ok(sample) => {
                    if written % self.channels == 0 {
                        self.gain += (target - self.gain).clamp(-self.ramp, self.ramp);
                    }
                    output[written] = convert(sample * self.gain);
                    written += 1;
                }
                Err(_) => break,
            }
        }
        for slot in &mut output[written..] {
            *slot = silence;
        }

        self.shared
            .consumed
            .fetch_add((written / self.channels) as u64, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region_of(start: u64, end: u64, reverse: bool) -> Region {
        Region {
            start,
            end,
            looping: false,
            reverse,
        }
    }

    #[test]
    fn the_feed_reserves_room_for_whatever_the_rate_conversion_produces() {
        let channels = 2;
        let upsampled = (FEED_FRAMES as u64 * 96_000).div_ceil(44_100) as usize;

        assert!(needed_slots(44_100, 96_000, channels) >= upsampled * channels);
        assert!(needed_slots(44_100, 48_000, channels) > FEED_FRAMES * channels);
        assert!(needed_slots(44_100, 44_100, channels) >= FEED_FRAMES * channels);
    }

    #[test]
    fn a_reported_position_moves_on_inside_the_block_it_lands_in() {
        let region = region_of(0, 100_000, false);

        assert_eq!(interpolated((1000, 5000), 1000, 1.0, region), 5000);
        assert_eq!(interpolated((1000, 5000), 1500, 1.0, region), 5500);
        assert_eq!(interpolated((1000, 5000), 1500, 0.5, region), 5250);
    }

    #[test]
    fn a_reported_position_walks_backwards_while_the_region_is_reversed() {
        let region = region_of(0, 100_000, true);

        assert_eq!(interpolated((1000, 5000), 1500, 1.0, region), 4500);
    }

    #[test]
    fn a_reported_position_never_leaves_the_region() {
        assert_eq!(
            interpolated((0, 9000), 100_000, 1.0, region_of(1000, 9500, false)),
            9500
        );
        assert_eq!(
            interpolated((0, 1200), 100_000, 1.0, region_of(1000, 9500, true)),
            1000
        );
    }

    #[test]
    fn the_output_fades_in_instead_of_opening_at_full_gain() {
        let (mut producer, consumer) = RingBuffer::<f32>::new(64);
        for _ in 0..64 {
            producer.push(1.0).expect("push");
        }
        let mut drain = Drain::new(consumer, Arc::new(Shared::new()), 1, 48_000);

        let mut output = [0.0f32; 64];
        drain.fill(&mut output);

        assert!(output[0] < 0.05, "opened at {} rather than fading in", output[0]);
        for pair in output.windows(2) {
            assert!(pair[1] >= pair[0], "the fade is not monotonic");
        }
        assert!(output[63] > output[0]);
    }

    #[test]
    fn the_ramp_settles_exactly_on_the_wanted_gain() {
        let (mut producer, consumer) = RingBuffer::<f32>::new(4096);
        for _ in 0..4096 {
            producer.push(1.0).expect("push");
        }
        let mut drain = Drain::new(consumer, Arc::new(Shared::new()), 1, 48_000);

        let mut output = [0.0f32; 4096];
        drain.fill(&mut output);

        assert_eq!(output[4095], 1.0);
    }

    #[test]
    fn a_mono_source_is_copied_to_every_device_channel() {
        let frame = [0.5];

        assert_eq!(mixed(&frame, 1, 0, 2), 0.5);
        assert_eq!(mixed(&frame, 1, 1, 2), 0.5);
    }

    #[test]
    fn a_stereo_source_is_averaged_down_to_a_mono_device() {
        let frame = [1.0, 0.0];

        assert_eq!(mixed(&frame, 2, 0, 1), 0.5);
    }

    #[test]
    fn a_stereo_source_maps_channel_for_channel_on_a_stereo_device() {
        let frame = [0.25, -0.75];

        assert_eq!(mixed(&frame, 2, 0, 2), 0.25);
        assert_eq!(mixed(&frame, 2, 1, 2), -0.75);
    }

    #[test]
    fn a_device_with_more_channels_than_the_source_gets_silence_on_the_extras() {
        let frame = [0.25, -0.75];

        assert_eq!(mixed(&frame, 2, 4, 6), 0.0);
    }

    fn active_with_marks(marks: &[(u64, u64)]) -> VecDeque<(u64, u64)> {
        marks.iter().copied().collect()
    }

    #[test]
    fn the_reported_position_comes_from_frames_the_device_consumed() {
        let marks = active_with_marks(&[(0, 1000), (500, 1500), (1000, 2000)]);

        let at = |consumed: u64| {
            marks
                .iter()
                .rev()
                .find(|(output_frame, _)| *output_frame <= consumed)
                .map(|(_, source)| *source)
        };

        assert_eq!(at(0), Some(1000));
        assert_eq!(at(499), Some(1000));
        assert_eq!(at(500), Some(1500));
        assert_eq!(at(1200), Some(2000));
    }

    #[test]
    fn a_play_request_deserialises_from_the_frontend_shape() {
        let request: PlayRequest = serde_json::from_str(
            r#"{"path":"/samples/kick.wav","startFrame":0,"endFrame":44100,"looping":true,"gain":0.8}"#,
        )
        .expect("deserialize");

        assert_eq!(request.start_frame, 0);
        assert_eq!(request.end_frame, 44_100);
        assert!(request.looping);
        assert!(!request.reverse);
        assert_eq!(request.gain, 0.8);
    }
}
