use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Timestamp;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioSpec {
    pub channels: u16,
    pub sample_rate: u32,
    pub frames: Option<u64>,
}

pub struct AudioSource {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    spec: AudioSpec,
    interleaved: Vec<f32>,
    finished: bool,
}

pub struct CountingSource {
    file: File,
    length: u64,
    bytes_read: Arc<AtomicU64>,
}

impl CountingSource {
    pub fn open(path: &Path) -> Result<(Self, Arc<AtomicU64>)> {
        let file = File::open(path)?;
        let length = file.metadata()?.len();
        let bytes_read = Arc::new(AtomicU64::new(0));

        Ok((
            Self {
                file,
                length,
                bytes_read: Arc::clone(&bytes_read),
            },
            bytes_read,
        ))
    }
}

impl Read for CountingSource {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let read = self.file.read(buffer)?;
        self.bytes_read.fetch_add(read as u64, Ordering::Relaxed);
        Ok(read)
    }
}

impl Seek for CountingSource {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.file.seek(position)
    }
}

impl MediaSource for CountingSource {
    fn is_seekable(&self) -> bool {
        true
    }

    fn byte_len(&self) -> Option<u64> {
        Some(self.length)
    }
}

impl AudioSource {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path)?;
        Self::from_media_source(Box::new(file), hint_for(path))
    }

    pub fn open_counted(path: &Path) -> Result<(Self, Arc<AtomicU64>)> {
        let (source, bytes_read) = CountingSource::open(path)?;
        let opened = Self::from_media_source(Box::new(source), hint_for(path))?;
        Ok((opened, bytes_read))
    }

    pub fn from_media_source(source: Box<dyn MediaSource>, hint: Hint) -> Result<Self> {
        let stream = MediaSourceStream::new(source, Default::default());
        let format = symphonia::default::get_probe()
            .probe(
                &hint,
                stream,
                FormatOptions::default(),
                MetadataOptions::default(),
            )
            .map_err(audio_error)?;

        let track = format
            .first_track_known_codec(TrackType::Audio)
            .ok_or_else(|| Error::Audio("the file holds no decodable audio track".into()))?;

        let parameters = track
            .codec_params
            .as_ref()
            .and_then(|params| params.audio())
            .ok_or_else(|| Error::Audio("the audio track declares no codec parameters".into()))?;

        let spec = AudioSpec {
            channels: parameters
                .channels
                .as_ref()
                .ok_or_else(|| Error::Audio("the audio track declares no channels".into()))?
                .count() as u16,
            sample_rate: parameters
                .sample_rate
                .ok_or_else(|| Error::Audio("the audio track declares no sample rate".into()))?,
            frames: track.num_frames,
        };
        let track_id = track.id;
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(parameters, &AudioDecoderOptions::default())
            .map_err(audio_error)?;

        Ok(Self {
            format,
            decoder,
            track_id,
            spec,
            interleaved: Vec::new(),
            finished: false,
        })
    }

    pub fn spec(&self) -> AudioSpec {
        self.spec
    }

    pub fn seek_to_frame(&mut self, frame: u64) -> Result<u64> {
        let seeked = self
            .format
            .seek(
                SeekMode::Accurate,
                SeekTo::Timestamp {
                    ts: Timestamp::try_from(frame)
                        .map_err(|_| Error::Audio("that frame is out of range".into()))?,
                    track_id: self.track_id,
                },
            )
            .map_err(audio_error)?;

        self.decoder.reset();
        self.finished = false;
        Ok(seeked.actual_ts.get().max(0) as u64)
    }

    pub fn next_block(&mut self) -> Result<Option<(u64, &[f32])>> {
        if self.finished {
            return Ok(None);
        }

        loop {
            let packet = match self.format.next_packet() {
                Ok(Some(packet)) => packet,
                Ok(None) => {
                    self.finished = true;
                    return Ok(None);
                }
                Err(error) if is_end_of_stream(&error) => {
                    self.finished = true;
                    return Ok(None);
                }
                Err(error) => return Err(audio_error(error)),
            };

            if packet.track_id != self.track_id {
                continue;
            }
            let timestamp = packet.pts.get().max(0) as u64;

            let trim_start = packet.trim_start.get() as usize;
            let trim_end = packet.trim_end.get() as usize;

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    decoded.copy_to_vec_interleaved(&mut self.interleaved);

                    let samples_per_frame = usize::from(self.spec.channels);
                    let start = (trim_start * samples_per_frame).min(self.interleaved.len());
                    let end = self
                        .interleaved
                        .len()
                        .saturating_sub(trim_end * samples_per_frame)
                        .max(start);

                    if start == end {
                        continue;
                    }
                    return Ok(Some((timestamp, &self.interleaved[start..end])));
                }
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(error) if is_end_of_stream(&error) => {
                    self.finished = true;
                    return Ok(None);
                }
                Err(error) => return Err(audio_error(error)),
            }
        }
    }
}

fn hint_for(path: &Path) -> Hint {
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    hint
}

fn is_end_of_stream(error: &SymphoniaError) -> bool {
    match error {
        SymphoniaError::IoError(io) => io.kind() == std::io::ErrorKind::UnexpectedEof,
        SymphoniaError::ResetRequired => true,
        _ => false,
    }
}

fn audio_error(error: SymphoniaError) -> Error {
    Error::Audio(error.to_string())
}
