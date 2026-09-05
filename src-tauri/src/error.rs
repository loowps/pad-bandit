use serde::ser::SerializeStruct;
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

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::OutsideWritableScope(_) => "outsideWritableScope",
            Self::OutsideReadableScope(_) => "outsideReadableScope",
            Self::UnresolvablePath(_) => "unresolvablePath",
            Self::NotADirectory(_) => "notADirectory",
            Self::NotACard { .. } => "notACard",
            Self::PadInfoTooShort { .. } => "padInfoTooShort",
            Self::UnknownSlot { .. } => "unknownSlot",
            Self::NoCardSelected => "noCardSelected",
            Self::CardChanged => "cardChanged",
            Self::SyncInProgress => "syncInProgress",
            Self::UnknownFolder(_) => "unknownFolder",
            Self::UngrantedFile(_) => "ungrantedFile",
            Self::UnnamedProject => "unnamedProject",
            Self::UnsupportedProjectVersion { .. } => "unsupportedProjectVersion",
            Self::Audio(_) => "audio",
            Self::Window(_) => "window",
            Self::Io(_) => "io",
            Self::Serde(_) => "serde",
        }
    }
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let mut error = serializer.serialize_struct("Error", 2)?;
        error.serialize_field("code", self.code())?;
        error.serialize_field("message", &self.to_string())?;
        error.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_variant() -> Vec<Error> {
        vec![
            Error::OutsideWritableScope(PathBuf::from("/x")),
            Error::OutsideReadableScope(PathBuf::from("/x")),
            Error::UnresolvablePath(PathBuf::from("/x")),
            Error::NotADirectory(PathBuf::from("/x")),
            Error::NotACard {
                path: PathBuf::from("/x"),
            },
            Error::PadInfoTooShort {
                expected: 2,
                actual: 1,
            },
            Error::UnknownSlot { slot: 200 },
            Error::NoCardSelected,
            Error::CardChanged,
            Error::SyncInProgress,
            Error::UnknownFolder("f1".into()),
            Error::UngrantedFile(PathBuf::from("/x")),
            Error::UnnamedProject,
            Error::UnsupportedProjectVersion { version: 9 },
            Error::Audio("no decoder".into()),
            Error::Window("no window".into()),
            Error::Io(std::io::Error::other("disk gone")),
            Error::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
        ]
    }

    #[test]
    fn carries_a_code_beside_the_message() {
        let json = serde_json::to_value(Error::CardChanged).unwrap();

        assert_eq!(json["code"], "cardChanged");
        assert_eq!(
            json["message"],
            "the card changed since this plan was built"
        );
    }

    #[test]
    fn keeps_the_detail_the_message_already_had() {
        let json = serde_json::to_value(Error::UnknownFolder("f7".into())).unwrap();

        assert_eq!(json["code"], "unknownFolder");
        assert_eq!(json["message"], "no browse folder with id f7");
    }

    #[test]
    fn every_code_is_in_the_list_the_ui_reads() {
        let mut listed: Vec<String> =
            serde_json::from_str(include_str!("../tests/fixtures/error-codes.json")).unwrap();
        let mut sent: Vec<String> = every_variant()
            .iter()
            .map(|error| error.code().to_string())
            .collect();

        listed.sort();
        sent.sort();

        assert_eq!(
            sent, listed,
            "tests/fixtures/error-codes.json is what src-ui/src/domain/errors.ts is checked \
             against — update it in the same commit as the code it names"
        );
    }

    #[test]
    fn tells_every_variant_apart() {
        let variants = every_variant();
        let mut codes: Vec<&str> = variants.iter().map(Error::code).collect();
        let total = codes.len();

        codes.sort_unstable();
        codes.dedup();

        assert_eq!(codes.len(), total);
    }

    #[test]
    fn never_serialises_an_empty_code() {
        for error in every_variant() {
            let json = serde_json::to_value(&error).unwrap();

            assert!(!json["code"].as_str().unwrap().is_empty());
            assert!(!json["message"].as_str().unwrap().is_empty());
        }
    }
}
