use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use pad_bandit_tauri_lib::audio::play::{PlayRequest, PlaybackEvents, Player};

struct Recorder {
    positions: Arc<Mutex<Vec<u64>>>,
    ended: Arc<AtomicBool>,
    errors: Arc<Mutex<Vec<String>>>,
    events: Arc<AtomicU64>,
}

impl PlaybackEvents for Recorder {
    fn position(&self, frame: u64) {
        self.positions.lock().expect("lock").push(frame);
        self.events.fetch_add(1, Ordering::Relaxed);
    }

    fn ended(&self) {
        self.ended.store(true, Ordering::Relaxed);
        self.events.fetch_add(1, Ordering::Relaxed);
    }

    fn error(&self, message: String) {
        self.errors.lock().expect("lock").push(message);
        self.events.fetch_add(1, Ordering::Relaxed);
    }
}

fn write_tone(path: &Path, seconds: f32) {
    let sample_rate = 44_100u32;
    let channels = 2u16;
    let frames = (seconds * sample_rate as f32) as u32;
    let block_align = channels * 2;
    let data_length = frames * u32::from(block_align);

    let mut writer = BufWriter::new(std::fs::File::create(path).expect("create"));
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
        let phase = frame as f32 / sample_rate as f32 * 220.0 * std::f32::consts::TAU;
        let sample = (phase.sin() * 8000.0) as i16;
        for _channel in 0..channels {
            writer.write_all(&sample.to_le_bytes()).expect("write");
        }
    }
    writer.flush().expect("flush");
}

fn wait_until(deadline: Duration, mut done: impl FnMut() -> bool) -> bool {
    let until = Instant::now() + deadline;
    while Instant::now() < until {
        if done() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    done()
}

#[test]
fn a_region_plays_through_the_real_output_device_and_reports_its_end() {
    let directory = tempfile::TempDir::new().expect("temp dir");
    let path = directory.path().join("tone.wav");
    write_tone(&path, 0.6);

    let positions = Arc::new(Mutex::new(Vec::new()));
    let ended = Arc::new(AtomicBool::new(false));
    let errors = Arc::new(Mutex::new(Vec::new()));
    let events = Arc::new(AtomicU64::new(0));

    let player = Player::spawn(Recorder {
        positions: Arc::clone(&positions),
        ended: Arc::clone(&ended),
        errors: Arc::clone(&errors),
        events: Arc::clone(&events),
    });

    player
        .play(&PlayRequest {
            path: path.clone(),
            start_frame: 0,
            end_frame: 26_460,
            looping: false,
            reverse: false,
            gain: 0.0,
        })
        .expect("play");

    let finished = wait_until(Duration::from_secs(5), || {
        ended.load(Ordering::Relaxed) || !errors.lock().expect("lock").is_empty()
    });

    let failures = errors.lock().expect("lock").clone();
    if let Some(first) = failures.first()
        && first.contains("no audio output device")
    {
        eprintln!("skipping: this machine has no audio output device");
        return;
    }

    assert!(failures.is_empty(), "playback reported {failures:?}");
    assert!(finished, "playback never reported that it ended");

    let reported = positions.lock().expect("lock").clone();
    assert!(
        !reported.is_empty(),
        "no position was reported while playing"
    );
    assert!(
        reported.iter().all(|frame| *frame <= 26_460),
        "a position ran past the region end: {reported:?}"
    );
    assert!(
        reported.windows(2).all(|pair| pair[1] >= pair[0]),
        "positions went backwards during forward playback: {reported:?}"
    );
}

#[test]
fn stopping_mid_play_is_silent_and_reports_nothing_further() {
    let directory = tempfile::TempDir::new().expect("temp dir");
    let path = directory.path().join("tone.wav");
    write_tone(&path, 3.0);

    let ended = Arc::new(AtomicBool::new(false));
    let errors = Arc::new(Mutex::new(Vec::new()));

    let player = Player::spawn(Recorder {
        positions: Arc::new(Mutex::new(Vec::new())),
        ended: Arc::clone(&ended),
        errors: Arc::clone(&errors),
        events: Arc::new(AtomicU64::new(0)),
    });

    player
        .play(&PlayRequest {
            path,
            start_frame: 0,
            end_frame: 132_300,
            looping: true,
            reverse: false,
            gain: 0.0,
        })
        .expect("play");

    std::thread::sleep(Duration::from_millis(200));
    player.stop().expect("stop");
    std::thread::sleep(Duration::from_millis(200));

    let failures = errors.lock().expect("lock").clone();
    if failures
        .iter()
        .any(|e| e.contains("no audio output device"))
    {
        eprintln!("skipping: this machine has no audio output device");
        return;
    }
    assert!(failures.is_empty(), "playback reported {failures:?}");
    assert!(
        !ended.load(Ordering::Relaxed),
        "a stopped loop should not report that it ended on its own"
    );
}

#[test]
fn a_missing_file_fails_the_command_rather_than_the_audio_thread() {
    let player = Player::spawn(Recorder {
        positions: Arc::new(Mutex::new(Vec::new())),
        ended: Arc::new(AtomicBool::new(false)),
        errors: Arc::new(Mutex::new(Vec::new())),
        events: Arc::new(AtomicU64::new(0)),
    });

    let outcome = player.play(&PlayRequest {
        path: "definitely-not-here.wav".into(),
        start_frame: 0,
        end_frame: 1000,
        looping: false,
        reverse: false,
        gain: 1.0,
    });

    assert!(outcome.is_err());
    assert!(
        player.stop().is_ok(),
        "the audio thread should still be alive"
    );
}
