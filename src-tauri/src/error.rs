use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("path is outside every writable root: {0}")]
    OutsideWritableScope(PathBuf),

    #[error("path is outside every readable root: {0}")]
    OutsideReadableScope(PathBuf),

    #[error("path cannot be resolved: {0}")]
    UnresolvablePath(PathBuf),

    #[error("not a directory: {0}")]
    NotADirectory(PathBuf),

    #[error("no pad data at {}/{} in {path}", crate::card::CARD_SEGMENTS.join("/"), crate::card::PAD_INFO_FILE_NAME)]
    NotACard { path: PathBuf },

    #[error("pad data is {actual} bytes, expected at least {expected}")]
    PadInfoTooShort { expected: usize, actual: usize },

    #[error("slot {slot} is outside the {} pads on a card", crate::card::PAD_COUNT)]
    UnknownSlot { slot: u8 },

    #[error("no card folder is selected")]
    NoCardSelected,

    #[error("the card changed since this plan was built")]
    CardChanged,

    #[error("a sync is already running")]
    SyncInProgress,

    #[error("no browse folder with id {0}")]
    UnknownFolder(String),

    #[error("this file was not chosen in a dialog: {0}")]
    UngrantedFile(PathBuf),

    #[error("a project needs a name")]
    UnnamedProject,

    #[error("project format version {version} is newer than this app understands")]
    UnsupportedProjectVersion { version: u32 },

    #[error("{0}")]
    Audio(String),

    #[error("{0}")]
    Window(String),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
