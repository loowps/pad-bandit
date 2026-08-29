use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::Result;
use crate::paths::Scopes;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub size: u64,
    pub ext: Option<String>,
}

pub fn list_dir(scopes: &Scopes, path: &Path) -> Result<Vec<Entry>> {
    let directory = scopes.readable(path)?;
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(&directory)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = entry
            .metadata()
            .or_else(|_| entry.path().symlink_metadata())?;
        let is_dir = metadata.is_dir();

        entries.push(Entry {
            ext: extension_of(&name, is_dir),
            path: directory.join(&name),
            name,
            is_dir,
            size: if is_dir { 0 } else { metadata.len() },
        });
    }

    entries.sort_by(compare_entries);
    Ok(entries)
}

fn extension_of(name: &str, is_dir: bool) -> Option<String> {
    if is_dir {
        return None;
    }
    Path::new(name)
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
}

fn compare_entries(first: &Entry, second: &Entry) -> Ordering {
    second
        .is_dir
        .cmp(&first.is_dir)
        .then_with(|| compare_naturally(&first.name, &second.name))
        .then_with(|| first.name.cmp(&second.name))
}

#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum Chunk {
    Number(u128),
    Text(String),
}

pub fn compare_naturally(first: &str, second: &str) -> Ordering {
    chunks(first).cmp(&chunks(second))
}

fn chunks(value: &str) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut characters = value.chars().peekable();

    while let Some(&next) = characters.peek() {
        if next.is_ascii_digit() {
            let mut digits = String::new();
            while characters.peek().is_some_and(char::is_ascii_digit) {
                digits.push(characters.next().expect("peeked"));
            }
            chunks.push(Chunk::Number(digits.parse().unwrap_or(u128::MAX)));
        } else {
            let mut text = String::new();
            while let Some(&next) = characters.peek() {
                if next.is_ascii_digit() {
                    break;
                }
                text.extend(next.to_lowercase());
                characters.next();
            }
            chunks.push(Chunk::Text(text));
        }
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Fixture {
        _root: TempDir,
        browse: PathBuf,
        elsewhere: PathBuf,
        scopes: Scopes,
    }

    fn fixture() -> Fixture {
        let root = TempDir::new().expect("temp dir");
        let browse = root.path().join("browse");
        let elsewhere = root.path().join("elsewhere");
        for dir in [&browse, &elsewhere] {
            std::fs::create_dir_all(dir).expect("create dir");
        }
        let mut scopes = Scopes::new(&root.path().join("app-data")).expect("scopes");
        scopes.add_read_root(&browse).expect("read root");

        Fixture {
            _root: root,
            browse,
            elsewhere,
            scopes,
        }
    }

    fn write(path: &Path, bytes: &[u8]) {
        std::fs::write(path, bytes).expect("write file");
    }

    #[test]
    fn directories_come_first_and_names_sort_naturally() {
        let f = fixture();
        for name in ["take10", "take9", "take1"] {
            write(&f.browse.join(format!("{name}.wav")), b"x");
        }
        std::fs::create_dir(f.browse.join("zed")).expect("create dir");
        std::fs::create_dir(f.browse.join("alpha")).expect("create dir");

        let names: Vec<String> = list_dir(&f.scopes, &f.browse)
            .expect("list")
            .into_iter()
            .map(|entry| entry.name)
            .collect();

        assert_eq!(
            names,
            ["alpha", "zed", "take1.wav", "take9.wav", "take10.wav"]
        );
    }

    #[test]
    fn every_entry_is_reported_regardless_of_extension() {
        let f = fixture();
        write(&f.browse.join("kick.WAV"), b"1234");
        write(&f.browse.join("notes.txt"), b"12");
        write(&f.browse.join("readme"), b"1");

        let entries = list_dir(&f.scopes, &f.browse).expect("list");

        assert_eq!(entries.len(), 3);
        let kick = &entries[0];
        assert_eq!(kick.name, "kick.WAV");
        assert_eq!(kick.ext.as_deref(), Some("wav"));
        assert_eq!(kick.size, 4);
        assert!(!kick.is_dir);
        assert_eq!(entries[2].ext, None);
    }

    #[test]
    fn a_directory_outside_the_read_roots_is_refused() {
        let f = fixture();

        assert!(list_dir(&f.scopes, &f.elsewhere).is_err());
    }

    #[test]
    fn a_listed_path_can_be_listed_again() {
        let f = fixture();
        let nested = f.browse.join("drums");
        std::fs::create_dir(&nested).expect("create dir");
        write(&nested.join("snare.aif"), b"x");

        let entries = list_dir(&f.scopes, &f.browse).expect("list");
        let child = list_dir(&f.scopes, &entries[0].path).expect("list child");

        assert_eq!(child[0].name, "snare.aif");
    }

    #[test]
    fn natural_ordering_handles_digits_inside_names() {
        assert_eq!(compare_naturally("A2", "A10"), Ordering::Less);
        assert_eq!(compare_naturally("a2", "A10"), Ordering::Less);
        assert_eq!(compare_naturally("A0000012", "B0000001"), Ordering::Less);
        assert_eq!(compare_naturally("take2b", "take2a"), Ordering::Greater);
    }
}
