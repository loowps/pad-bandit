use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::Result;
use crate::fs::{compare_naturally, is_audio_file};
use crate::paths::Scopes;

pub const MAX_FILES_PER_ROOT: usize = 200_000;
pub const MAX_DIRECTORIES_PER_ROOT: usize = 50_000;
pub const MAX_RESULTS: usize = 500;
pub const MIN_QUERY_LENGTH: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: PathBuf,
    pub name: String,
    pub location: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Indexed {
    relative: PathBuf,
    lower_name: String,
    lower_location: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RootIndex {
    files: Vec<Indexed>,
    truncated: bool,
}

pub fn build(scopes: &Scopes, root: &Path) -> Result<RootIndex> {
    let start = scopes.readable(root)?;
    let mut files = Vec::new();
    let mut truncated = false;
    let mut visited = 0usize;
    let mut queue = VecDeque::from([start.clone()]);

    'walk: while let Some(directory) = queue.pop_front() {
        visited += 1;
        if visited > MAX_DIRECTORIES_PER_ROOT {
            truncated = true;
            break;
        }

        let Ok(listing) = std::fs::read_dir(&directory) else {
            continue;
        };

        for entry in listing.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let is_link = file_type.is_symlink();
            let leads_to_directory = if is_link {
                entry.metadata().map(|data| data.is_dir()).unwrap_or(true)
            } else {
                file_type.is_dir()
            };

            if leads_to_directory {
                if !is_link {
                    queue.push_back(entry.path());
                }
                continue;
            }

            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_audio_file(&name, false) {
                continue;
            }

            if files.len() >= MAX_FILES_PER_ROOT {
                truncated = true;
                break 'walk;
            }

            let path = entry.path();
            let Ok(relative) = path.strip_prefix(&start) else {
                continue;
            };

            files.push(Indexed {
                lower_name: name.to_lowercase(),
                lower_location: location_of(relative).to_lowercase(),
                relative: relative.to_path_buf(),
            });
        }
    }

    Ok(RootIndex { files, truncated })
}

pub fn search(roots: &[(&Path, &RootIndex)], query: &str, limit: usize) -> SearchOutcome {
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < MIN_QUERY_LENGTH {
        return SearchOutcome::default();
    }

    let mut ordered: Vec<(&Path, &RootIndex)> = roots.to_vec();
    ordered.sort_by(|first, second| first.0.cmp(second.0));

    let mut matches: Vec<(bool, &Path, &Indexed)> = Vec::new();
    for (root, index) in &ordered {
        for file in &index.files {
            let in_name = file.lower_name.contains(&needle);
            if in_name || file.lower_location.contains(&needle) {
                matches.push((in_name, root, file));
            }
        }
    }

    matches.sort_by(|first, second| {
        second.0.cmp(&first.0).then_with(|| {
            compare_naturally(
                &first.2.relative.to_string_lossy(),
                &second.2.relative.to_string_lossy(),
            )
        })
    });

    let partial = ordered.iter().any(|(_, index)| index.truncated);
    let truncated = partial || matches.len() > limit;
    let hits = matches
        .into_iter()
        .take(limit)
        .map(|(_, root, file)| SearchHit {
            path: root.join(&file.relative),
            name: file_name_of(&file.relative),
            location: location_of(&file.relative),
        })
        .collect();

    SearchOutcome { hits, truncated }
}

fn file_name_of(relative: &Path) -> String {
    relative
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn location_of(relative: &Path) -> String {
    relative
        .parent()
        .map(|parent| parent.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

#[derive(Debug)]
enum Entry {
    Building,
    Ready(RootIndex),
    Failed,
}

#[derive(Debug, Default)]
pub struct Indexes {
    by_root: HashMap<PathBuf, Entry>,
}

impl Indexes {
    pub fn mark_building(&mut self, root: &Path) {
        self.by_root.insert(root.to_path_buf(), Entry::Building);
    }

    pub fn store(&mut self, root: &Path, index: RootIndex) {
        self.by_root.insert(root.to_path_buf(), Entry::Ready(index));
    }

    pub fn mark_failed(&mut self, root: &Path) {
        self.by_root.insert(root.to_path_buf(), Entry::Failed);
    }

    pub fn forget(&mut self, root: &Path) {
        self.by_root.remove(root);
    }

    pub fn retain_roots(&mut self, roots: &[PathBuf]) {
        self.by_root.retain(|root, _| roots.contains(root));
    }

    pub fn is_ready(&self, root: &Path) -> bool {
        matches!(self.by_root.get(root), Some(Entry::Ready(_)))
    }

    pub fn is_building(&self) -> bool {
        self.by_root
            .values()
            .any(|entry| matches!(entry, Entry::Building))
    }

    pub fn search(&self, query: &str, limit: usize) -> SearchOutcome {
        let ready: Vec<(&Path, &RootIndex)> = self
            .by_root
            .iter()
            .filter_map(|(root, entry)| match entry {
                Entry::Ready(index) => Some((root.as_path(), index)),
                _ => None,
            })
            .collect();

        search(&ready, query, limit)
    }

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
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, bytes).expect("write file");
    }

    fn found(outcome: &SearchOutcome) -> Vec<String> {
        outcome.hits.iter().map(|hit| hit.name.clone()).collect()
    }

    fn search_in(index: &RootIndex, root: &Path, query: &str) -> SearchOutcome {
        search(&[(root, index)], query, MAX_RESULTS)
    }

    #[test]
    fn nested_audio_files_are_indexed_and_other_files_are_not() {
        let f = fixture();
        write(&f.browse.join("kick.wav"), b"1234");
        write(&f.browse.join("drums/kicks/deep kick.aiff"), b"12");
        write(&f.browse.join("drums/notes.txt"), b"1");

        let index = build(&f.scopes, &f.browse).expect("build");

        assert_eq!(
            found(&search_in(&index, &f.browse, "ki")),
            ["deep kick.aiff", "kick.wav"]
        );
        assert!(search_in(&index, &f.browse, "notes").hits.is_empty());
        assert!(!search_in(&index, &f.browse, "ki").truncated);
    }

    #[test]
    fn a_root_outside_the_read_roots_is_refused() {
        let f = fixture();

        assert!(build(&f.scopes, &f.elsewhere).is_err());
    }

    #[test]
    fn a_query_matches_the_file_name_regardless_of_case() {
        let f = fixture();
        write(&f.browse.join("drums/DeepKick.wav"), b"1");
        write(&f.browse.join("drums/snare.wav"), b"1");

        let index = build(&f.scopes, &f.browse).expect("build");

        assert_eq!(
            found(&search_in(&index, &f.browse, "deepkick")),
            ["DeepKick.wav"]
        );
        assert_eq!(found(&search_in(&index, &f.browse, "SNARE")), ["snare.wav"]);
    }

    #[test]
    fn a_query_matches_a_parent_folder_name() {
        let f = fixture();
        write(&f.browse.join("Drums/one.wav"), b"1");
        write(&f.browse.join("Bass/two.wav"), b"1");

        let index = build(&f.scopes, &f.browse).expect("build");

        assert_eq!(found(&search_in(&index, &f.browse, "drums")), ["one.wav"]);
    }

    #[test]
    fn a_hit_carries_the_folder_it_was_found_in() {
        let f = fixture();
        write(&f.browse.join("drums/kicks/kick.wav"), b"1");
        write(&f.browse.join("loose.wav"), b"1");

        let index = build(&f.scopes, &f.browse).expect("build");
        let nested = search_in(&index, &f.browse, "kick.wav");
        let loose = search_in(&index, &f.browse, "loose");

        assert_eq!(nested.hits[0].location, "drums/kicks");
        assert_eq!(nested.hits[0].path, f.browse.join("drums/kicks/kick.wav"));
        assert_eq!(loose.hits[0].location, "");
    }

    #[test]
    fn name_matches_come_before_folder_matches() {
        let f = fixture();
        write(&f.browse.join("brass/loop.wav"), b"1");
        write(&f.browse.join("drums/brass hit.wav"), b"1");

        let index = build(&f.scopes, &f.browse).expect("build");

        assert_eq!(
            found(&search_in(&index, &f.browse, "brass")),
            ["brass hit.wav", "loop.wav"]
        );
    }

    #[test]
    fn a_query_shorter_than_the_minimum_finds_nothing() {
        let f = fixture();
        write(&f.browse.join("kick.wav"), b"1");

        let index = build(&f.scopes, &f.browse).expect("build");

        assert!(search_in(&index, &f.browse, "k").hits.is_empty());
        assert!(search_in(&index, &f.browse, " ").hits.is_empty());
        assert_eq!(found(&search_in(&index, &f.browse, "ki")), ["kick.wav"]);
    }

    #[test]
    fn results_past_the_limit_are_reported_as_truncated() {
        let f = fixture();
        for number in 0..12 {
            write(&f.browse.join(format!("kick{number}.wav")), b"1");
        }

        let index = build(&f.scopes, &f.browse).expect("build");
        let outcome = search(&[(f.browse.as_path(), &index)], "kick", 5);

        assert_eq!(outcome.hits.len(), 5);
        assert!(outcome.truncated);
        assert!(!search_in(&index, &f.browse, "kick").truncated);
    }

    #[test]
    fn hits_are_ordered_naturally_by_path() {
        let f = fixture();
        for number in [10, 9, 1] {
            write(&f.browse.join(format!("take{number}.wav")), b"1");
        }

        let index = build(&f.scopes, &f.browse).expect("build");

        assert_eq!(
            found(&search_in(&index, &f.browse, "take")),
            ["take1.wav", "take9.wav", "take10.wav"]
        );
    }

    #[test]
    fn searching_spans_every_ready_root() {
        let f = fixture();
        let second = f.browse.parent().expect("parent").join("second");
        std::fs::create_dir_all(&second).expect("create dir");
        write(&f.browse.join("kick one.wav"), b"1");
        write(&second.join("kick two.wav"), b"1");

        let mut scopes = f.scopes.clone();
        scopes.add_read_root(&second).expect("read root");
        let first = build(&scopes, &f.browse).expect("build");
        let other = build(&scopes, &second).expect("build");

        let outcome = search(
            &[(f.browse.as_path(), &first), (second.as_path(), &other)],
            "kick",
            MAX_RESULTS,
        );

        assert_eq!(found(&outcome), ["kick one.wav", "kick two.wav"]);
    }

    #[test]
    fn an_empty_index_set_finds_nothing() {
        assert_eq!(search(&[], "kick", MAX_RESULTS), SearchOutcome::default());
    }

    #[test]
    fn a_removed_root_is_no_longer_searched() {
        let f = fixture();
        write(&f.browse.join("kick.wav"), b"1");
        let index = build(&f.scopes, &f.browse).expect("build");

        let mut indexes = Indexes::default();
        indexes.store(&f.browse, index);
        assert_eq!(found(&indexes.search("kick", MAX_RESULTS)), ["kick.wav"]);

        indexes.forget(&f.browse);

        assert!(indexes.search("kick", MAX_RESULTS).hits.is_empty());
        assert!(!indexes.is_ready(&f.browse));
    }

    #[test]
    fn only_ready_roots_are_searched() {
        let f = fixture();
        write(&f.browse.join("kick.wav"), b"1");
        let index = build(&f.scopes, &f.browse).expect("build");
        let pending = f.browse.parent().expect("parent").join("pending");

        let mut indexes = Indexes::default();
        indexes.store(&f.browse, index);
        indexes.mark_building(&pending);

        assert_eq!(found(&indexes.search("kick", MAX_RESULTS)), ["kick.wav"]);
        assert!(indexes.is_building());
        assert!(indexes.is_ready(&f.browse));
        assert!(!indexes.is_ready(&pending));
    }

    #[test]
    fn a_root_that_failed_to_index_is_neither_ready_nor_building() {
        let mut indexes = Indexes::default();
        let broken = PathBuf::from("broken");
        indexes.mark_failed(&broken);

        assert!(!indexes.is_ready(&broken));
        assert!(!indexes.is_building());
    }

    #[test]
    fn retaining_roots_drops_the_ones_that_are_gone() {
        let mut indexes = Indexes::default();
        let kept = PathBuf::from("kept");
        let gone = PathBuf::from("gone");
        indexes.store(&kept, RootIndex::default());
        indexes.mark_building(&gone);
        assert!(indexes.is_building());

        indexes.retain_roots(std::slice::from_ref(&kept));

        assert!(!indexes.is_building());
        assert!(indexes.is_ready(&kept));
    }

    #[test]
    fn a_capped_index_reports_its_results_as_partial() {
        let f = fixture();
        write(&f.browse.join("kick.wav"), b"1");
        let mut index = build(&f.scopes, &f.browse).expect("build");
        index.truncated = true;

        assert!(search_in(&index, &f.browse, "kick").truncated);
    }

    #[cfg(unix)]
    #[test]
    fn a_directory_symlink_is_not_followed() {
        let f = fixture();
        write(&f.browse.join("real/kick.wav"), b"1");
        std::os::unix::fs::symlink(f.browse.join("real"), f.browse.join("link")).expect("symlink");

        let index = build(&f.scopes, &f.browse).expect("build");

        assert_eq!(found(&search_in(&index, &f.browse, "kick")), ["kick.wav"]);
    }
}
