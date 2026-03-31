//! Single-entry display cache for avoiding redundant backend snapshots.
//!
//! The cache stores the last `DisplayPayload` keyed by
//! `(state_revision, DisplaySelection)`. A hit means the backend state
//! hasn't changed and the selection hasn't changed — the previous
//! snapshot is still valid.

use super::display::{DisplayPayload, DisplaySelection};

/// Single-entry LRU cache for display snapshots.
///
/// Key: `(state_revision, DisplaySelection)`.
/// Value: the resulting `DisplayPayload`.
///
/// Invariant: if the cache is valid, the stored payload is identical
/// to what `InteractiveRuntime::refresh_display()` would produce.
pub(crate) struct DisplayCache {
    cached_state_rev: u64,
    cached_selection: DisplaySelection,
    cached_payload: Option<DisplayPayload>,
}

impl DisplayCache {
    pub fn new() -> Self {
        Self {
            cached_state_rev: u64::MAX, // invalid sentinel
            cached_selection: DisplaySelection::default(),
            cached_payload: None,
        }
    }

    /// Check if the cache contains a valid payload for the given key.
    pub fn get(&self, state_rev: u64, selection: &DisplaySelection) -> Option<&DisplayPayload> {
        if self.cached_state_rev == state_rev && self.cached_selection == *selection {
            self.cached_payload.as_ref()
        } else {
            None
        }
    }

    /// Store a payload in the cache.
    pub fn put(&mut self, state_rev: u64, selection: DisplaySelection, payload: DisplayPayload) {
        self.cached_state_rev = state_rev;
        self.cached_selection = selection;
        self.cached_payload = Some(payload);
    }

    /// Invalidate the cache (e.g. after state change or magnetization upload).
    pub fn invalidate(&mut self) {
        self.cached_state_rev = u64::MAX;
        self.cached_payload = None;
    }
}
