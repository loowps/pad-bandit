use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::state::AppState;

pub const ACTION_EVENT: &str = "menu-action";

const NEW: &str = "project.new";
const OPEN: &str = "project.open";
const SAVE: &str = "project.save";
const SAVE_AS: &str = "project.save-as";
const FORGET_RECENT: &str = "project.forget-recent";
const RECENT_PREFIX: &str = "project.recent.";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    New,
    Open,
    Save,
    SaveAs,
    ForgetRecent,
    #[serde(rename_all = "camelCase")]
    OpenRecent { path: PathBuf },
}

pub fn apply<R: Runtime>(app: &AppHandle<R>, recent: &[PathBuf]) -> tauri::Result<()> {
    let menu = build(app, recent)?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let recent = app.state::<AppState>().config().recent_projects;
    let Some(action) = action_of(event.id().as_ref(), &recent) else {
        return;
    };
    let _ = app.emit(ACTION_EVENT, action);
}

fn action_of(id: &str, recent: &[PathBuf]) -> Option<Action> {
    match id {
        NEW => Some(Action::New),
        OPEN => Some(Action::Open),
        SAVE => Some(Action::Save),
        SAVE_AS => Some(Action::SaveAs),
        FORGET_RECENT => Some(Action::ForgetRecent),
        _ => id
            .strip_prefix(RECENT_PREFIX)
            .and_then(|index| index.parse::<usize>().ok())
            .and_then(|index| recent.get(index))
            .map(|path| Action::OpenRecent {
                path: path.to_path_buf(),
            }),
    }
}

fn build<R: Runtime>(app: &AppHandle<R>, recent: &[PathBuf]) -> tauri::Result<Menu<R>> {
    let new = MenuItemBuilder::with_id(NEW, "&New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open = MenuItemBuilder::with_id(OPEN, "&Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id(SAVE, "&Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id(SAVE_AS, "Save &As…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;

    let project = SubmenuBuilder::new(app, "&Project")
        .item(&new)
        .item(&open)
        .item(&recent_submenu(app, recent)?)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .quit()
        .build()?;

    MenuBuilder::new(app).item(&project).build()
}

fn recent_submenu<R: Runtime>(
    app: &AppHandle<R>,
    recent: &[PathBuf],
) -> tauri::Result<tauri::menu::Submenu<R>> {
    let mut submenu = SubmenuBuilder::new(app, "Open &Recent");

    if recent.is_empty() {
        let empty = MenuItemBuilder::with_id("project.recent.empty", "No recent projects")
            .enabled(false)
            .build(app)?;
        return submenu.item(&empty).build();
    }

    for (index, path) in recent.iter().enumerate() {
        let item =
            MenuItemBuilder::with_id(format!("{RECENT_PREFIX}{index}"), recent_label(path))
                .build(app)?;
        submenu = submenu.item(&item);
    }

    let forget = MenuItemBuilder::with_id(FORGET_RECENT, "&Clear this list").build(app)?;
    submenu.separator().item(&forget).build()
}

fn recent_label(path: &Path) -> String {
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    let label = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => {
            format!("{name}  —  {}", parent.display())
        }
        _ => name,
    };
    label.replace('&', "&&")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recent() -> Vec<PathBuf> {
        vec![
            PathBuf::from("/sets/live.padbandit"),
            PathBuf::from("/other/live.padbandit"),
        ]
    }

    #[test]
    fn the_fixed_items_map_to_their_actions() {
        assert_eq!(action_of(NEW, &[]), Some(Action::New));
        assert_eq!(action_of(OPEN, &[]), Some(Action::Open));
        assert_eq!(action_of(SAVE, &[]), Some(Action::Save));
        assert_eq!(action_of(SAVE_AS, &[]), Some(Action::SaveAs));
        assert_eq!(action_of(FORGET_RECENT, &[]), Some(Action::ForgetRecent));
    }

    #[test]
    fn a_recent_item_resolves_by_position_not_by_its_label() {
        assert_eq!(
            action_of("project.recent.1", &recent()),
            Some(Action::OpenRecent {
                path: PathBuf::from("/other/live.padbandit"),
            })
        );
    }

    #[test]
    fn a_recent_item_that_no_longer_exists_does_nothing() {
        assert_eq!(action_of("project.recent.9", &recent()), None);
        assert_eq!(action_of("project.recent.empty", &recent()), None);
        assert_eq!(action_of("something.else", &recent()), None);
    }

    #[test]
    fn recent_labels_separate_same_named_projects_by_folder() {
        let labels: Vec<String> = recent().iter().map(|path| recent_label(path)).collect();

        assert_ne!(labels[0], labels[1]);
        assert!(labels[0].starts_with("live"));
    }

    #[test]
    fn an_ampersand_in_a_path_is_not_read_as_a_mnemonic() {
        assert_eq!(
            recent_label(Path::new("/dnb & jungle/live.padbandit")),
            "live  —  /dnb && jungle"
        );
    }
}
