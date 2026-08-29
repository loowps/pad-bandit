use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

#[derive(Debug, Default)]
pub struct Scopes {
    card_root: Option<PathBuf>,
    app_data: PathBuf,
    read_roots: Vec<PathBuf>,
}

impl Scopes {
    pub fn new(app_data: &Path) -> Result<Self> {
        std::fs::create_dir_all(app_data)?;
        Ok(Self {
            card_root: None,
            app_data: resolve(app_data)?,
            read_roots: Vec::new(),
        })
    }

    pub fn app_data(&self) -> &Path {
        &self.app_data
    }

    pub fn card_root(&self) -> Option<&Path> {
        self.card_root.as_deref()
    }

    pub fn set_card_root(&mut self, path: Option<&Path>) -> Result<Option<PathBuf>> {
        self.card_root = match path {
            Some(path) => Some(resolve_directory(path)?),
            None => None,
        };
        Ok(self.card_root.clone())
    }

    pub fn add_read_root(&mut self, path: &Path) -> Result<PathBuf> {
        let root = resolve_directory(path)?;
        if !self.read_roots.contains(&root) {
            self.read_roots.push(root.clone());
        }
        Ok(root)
    }

    pub fn remove_read_root(&mut self, path: &Path) {
        let Ok(root) = resolve(path) else { return };
        self.read_roots.retain(|existing| existing != &root);
    }

    pub fn replace_read_roots<P: AsRef<Path>>(&mut self, paths: impl IntoIterator<Item = P>) {
        self.read_roots.clear();
        for path in paths {
            let _ = self.add_read_root(path.as_ref());
        }
    }

    pub fn writable(&self, path: &Path) -> Result<PathBuf> {
        let resolved = resolve(path)?;
        if self.is_writable(&resolved) {
            Ok(resolved)
        } else {
            Err(Error::OutsideWritableScope(path.to_path_buf()))
        }
    }

    pub fn readable(&self, path: &Path) -> Result<PathBuf> {
        let resolved = resolve(path)?;
        let readable = self.is_writable(&resolved)
            || self.read_roots.iter().any(|root| contains(root, &resolved));
        if readable {
            Ok(resolved)
        } else {
            Err(Error::OutsideReadableScope(path.to_path_buf()))
        }
    }

    fn is_writable(&self, resolved: &Path) -> bool {
        contains(&self.app_data, resolved)
            || self
                .card_root
                .as_deref()
                .is_some_and(|root| contains(root, resolved))
    }
}

#[derive(Debug, Default)]
pub struct FileGrants {
    granted: Vec<PathBuf>,
}

impl FileGrants {
    pub fn grant(&mut self, path: &Path) -> Result<PathBuf> {
        let resolved = resolve(path)?;
        if !self.granted.contains(&resolved) {
            self.granted.push(resolved.clone());
        }
        Ok(resolved)
    }

    pub fn grant_all<P: AsRef<Path>>(&mut self, paths: impl IntoIterator<Item = P>) {
        for path in paths {
            let _ = self.grant(path.as_ref());
        }
    }

    pub fn revoke(&mut self, path: &Path) {
        let Ok(resolved) = resolve(path) else { return };
        self.granted.retain(|existing| existing != &resolved);
    }

    pub fn clear(&mut self) {
        self.granted.clear();
    }

    pub fn allows(&self, path: &Path) -> Result<PathBuf> {
        let resolved = resolve(path)?;
        if self.granted.contains(&resolved) {
            Ok(resolved)
        } else {
            Err(Error::UngrantedFile(path.to_path_buf()))
        }
    }
}

fn contains(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
}

fn resolve_directory(path: &Path) -> Result<PathBuf> {
    let resolved = resolve(path)?;
    if resolved.is_dir() {
        Ok(resolved)
    } else {
        Err(Error::NotADirectory(path.to_path_buf()))
    }
}

pub fn resolve(path: &Path) -> Result<PathBuf> {
    let mut tail: Vec<OsString> = Vec::new();
    let mut cursor = path.to_path_buf();

    loop {
        if let Ok(existing) = cursor.canonicalize() {
            let mut resolved = existing;
            resolved.extend(tail.iter().rev());
            return Ok(resolved);
        }
        let Some(name) = cursor.file_name().map(ToOwned::to_owned) else {
            return Err(Error::UnresolvablePath(path.to_path_buf()));
        };
        tail.push(name);
        if !cursor.pop() {
            return Err(Error::UnresolvablePath(path.to_path_buf()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct Fixture {
        _root: TempDir,
        app_data: PathBuf,
        card: PathBuf,
        browse: PathBuf,
        elsewhere: PathBuf,
        scopes: Scopes,
    }

    fn fixture() -> Fixture {
        let root = TempDir::new().expect("temp dir");
        let app_data = root.path().join("app-data");
        let card = root.path().join("card");
        let browse = root.path().join("browse");
        let elsewhere = root.path().join("elsewhere");
        for dir in [&card, &browse, &elsewhere] {
            std::fs::create_dir_all(dir).expect("create dir");
        }

        let mut scopes = Scopes::new(&app_data).expect("scopes");
        scopes.set_card_root(Some(&card)).expect("card root");
        scopes.add_read_root(&browse).expect("browse root");

        Fixture {
            _root: root,
            app_data,
            card,
            browse,
            elsewhere,
            scopes,
        }
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) -> bool {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return true;
        }
        let junction = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output();
        let created = junction.is_ok_and(|output| output.status.success());
        assert!(
            created,
            "neither a symlink nor a junction could be created, so the escape test proves nothing"
        );
        created
    }

    #[test]
    fn writable_accepts_paths_under_the_card_root_and_app_data() {
        let f = fixture();

        assert!(
            f.scopes
                .writable(&f.card.join("ROLAND/SMPL/A0000001.WAV"))
                .is_ok()
        );
        assert!(f.scopes.writable(&f.card).is_ok());
        assert!(f.scopes.writable(&f.app_data.join("config.json")).is_ok());
    }

    #[test]
    fn writable_rejects_a_path_outside_every_root() {
        let f = fixture();

        assert!(f.scopes.writable(&f.elsewhere.join("stolen.wav")).is_err());
    }

    #[test]
    fn writable_rejects_an_escape_through_parent_components() {
        let f = fixture();

        let escape = f.card.join("..").join("elsewhere").join("stolen.wav");
        assert!(f.scopes.writable(&escape).is_err());
    }

    #[test]
    fn writable_rejects_an_escape_through_a_symlink_out_of_the_card_root() {
        let f = fixture();
        let link = f.card.join("escape");
        if !link_dir(&f.elsewhere, &link) {
            return;
        }

        assert!(f.scopes.writable(&link.join("stolen.wav")).is_err());
    }

    #[test]
    fn a_browse_root_is_readable_but_never_writable() {
        let f = fixture();
        let source = f.browse.join("drums").join("kick.wav");

        assert!(f.scopes.readable(&source).is_ok());
        assert!(matches!(
            f.scopes.writable(&source),
            Err(Error::OutsideWritableScope(_))
        ));
        assert!(matches!(
            f.scopes.writable(&f.browse),
            Err(Error::OutsideWritableScope(_))
        ));
    }

    #[test]
    fn a_symlink_inside_a_browse_root_grants_no_scope_at_its_target() {
        let f = fixture();
        let link = f.browse.join("escape");
        if !link_dir(&f.elsewhere, &link) {
            return;
        }

        assert!(f.scopes.readable(&link.join("sample.wav")).is_err());
        assert!(f.scopes.writable(&link.join("sample.wav")).is_err());
    }

    #[test]
    fn readable_covers_the_card_root_but_not_unconfigured_folders() {
        let f = fixture();

        assert!(f.scopes.readable(&f.card.join("anything.wav")).is_ok());
        assert!(
            f.scopes
                .readable(&f.elsewhere.join("anything.wav"))
                .is_err()
        );
    }

    #[test]
    fn a_sibling_directory_sharing_a_name_prefix_is_not_inside_the_root() {
        let f = fixture();
        let sibling = f.card.with_file_name("card-backup");
        std::fs::create_dir_all(&sibling).expect("create dir");

        assert!(f.scopes.writable(&sibling.join("x.wav")).is_err());
    }

    #[test]
    fn clearing_the_card_root_removes_its_write_scope() {
        let mut f = fixture();
        let inside = f.card.join("PAD_INFO.BIN");
        assert!(f.scopes.writable(&inside).is_ok());

        f.scopes.set_card_root(None).expect("clear card root");
        assert!(f.scopes.writable(&inside).is_err());
    }

    #[test]
    fn a_card_root_that_is_not_a_directory_is_rejected() {
        let f = fixture();
        let file = f.card.join("PAD_INFO.BIN");
        std::fs::write(&file, b"x").expect("write file");

        let mut scopes = Scopes::new(&f.app_data).expect("scopes");
        assert!(matches!(
            scopes.set_card_root(Some(&file)),
            Err(Error::NotADirectory(_))
        ));
    }

    #[test]
    fn a_grant_covers_exactly_one_file_and_never_its_neighbours() {
        let f = fixture();
        let chosen = f.elsewhere.join("set.padbandit");
        let mut grants = FileGrants::default();

        grants.grant(&chosen).expect("grant");

        assert!(grants.allows(&chosen).is_ok());
        assert!(matches!(
            grants.allows(&f.elsewhere.join("other.padbandit")),
            Err(Error::UngrantedFile(_))
        ));
        assert!(grants.allows(&f.elsewhere).is_err());
        assert!(grants.allows(&chosen.join("nested")).is_err());
    }

    #[test]
    fn a_grant_widens_nothing_in_scopes() {
        let f = fixture();
        let chosen = f.elsewhere.join("set.padbandit");
        let mut grants = FileGrants::default();
        grants.grant(&chosen).expect("grant");

        assert!(matches!(
            f.scopes.writable(&chosen),
            Err(Error::OutsideWritableScope(_))
        ));
        assert!(matches!(
            f.scopes.readable(&chosen),
            Err(Error::OutsideReadableScope(_))
        ));
    }

    #[test]
    fn a_grant_is_matched_after_resolving_so_a_detour_cannot_dodge_it() {
        let f = fixture();
        let chosen = f.elsewhere.join("set.padbandit");
        let mut grants = FileGrants::default();
        grants.grant(&chosen).expect("grant");

        let detour = f.browse.join("..").join("elsewhere").join("set.padbandit");
        assert_eq!(
            grants.allows(&detour).expect("allowed"),
            resolve(&chosen).expect("resolve")
        );
    }

    #[test]
    fn revoking_and_clearing_close_a_grant_again() {
        let f = fixture();
        let first = f.elsewhere.join("one.padbandit");
        let second = f.elsewhere.join("two.padbandit");
        let mut grants = FileGrants::default();
        grants.grant_all([&first, &second]);

        grants.revoke(&first);
        assert!(grants.allows(&first).is_err());
        assert!(grants.allows(&second).is_ok());

        grants.clear();
        assert!(grants.allows(&second).is_err());
    }
}
