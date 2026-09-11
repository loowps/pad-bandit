use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager, Runtime, Window, WindowEvent};

pub const CLOSE_REQUESTED_EVENT: &str = "close-requested";

#[derive(Default)]
pub struct CloseGuard {
    unsaved: AtomicBool,
    asking: AtomicBool,
}

impl CloseGuard {
    pub fn set_unsaved(&self, unsaved: bool) {
        self.unsaved.store(unsaved, Ordering::SeqCst);
    }

    pub fn keep_open(&self) {
        self.asking.store(false, Ordering::SeqCst);
    }

    pub fn let_go(&self) {
        self.unsaved.store(false, Ordering::SeqCst);
    }

    fn holds_close(&self) -> bool {
        self.unsaved.load(Ordering::SeqCst) && !self.asking.swap(true, Ordering::SeqCst)
    }
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event
        && window.state::<CloseGuard>().holds_close()
    {
        api.prevent_close();
        let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_unsaved_lets_the_window_close() {
        assert!(!CloseGuard::default().holds_close());
    }

    #[test]
    fn unsaved_work_holds_the_first_close_and_asks() {
        let guard = CloseGuard::default();
        guard.set_unsaved(true);

        assert!(guard.holds_close());
    }

    #[test]
    fn a_second_close_while_asking_always_goes_through() {
        let guard = CloseGuard::default();
        guard.set_unsaved(true);
        guard.holds_close();

        assert!(!guard.holds_close());
    }

    #[test]
    fn keeping_the_window_open_makes_the_next_close_ask_again() {
        let guard = CloseGuard::default();
        guard.set_unsaved(true);
        guard.holds_close();

        guard.keep_open();

        assert!(guard.holds_close());
    }

    #[test]
    fn letting_go_closes_without_asking() {
        let guard = CloseGuard::default();
        guard.set_unsaved(true);

        guard.let_go();

        assert!(!guard.holds_close());
    }
}
