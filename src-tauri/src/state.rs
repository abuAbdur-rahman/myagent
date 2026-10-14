use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct StreamState {
    active: Mutex<HashMap<String, Arc<Notify>>>,
    cancelled: Mutex<HashSet<String>>,
}

fn poisoned(context: &str) -> AppError {
    AppError::Internal(format!("{context} lock poisoned"))
}

impl StreamState {
    pub fn register(&self, request_id: &str) -> AppResult<Arc<Notify>> {
        let notify = Arc::new(Notify::new());
        self.active
            .lock()
            .map_err(|_| poisoned("stream registry"))?
            .insert(request_id.to_string(), notify.clone());
        Ok(notify)
    }

    pub fn cancel(&self, request_id: &str) -> AppResult<()> {
        self.cancelled
            .lock()
            .map_err(|_| poisoned("stream registry"))?
            .insert(request_id.to_string());
        if let Ok(active) = self.active.lock() {
            if let Some(notify) = active.get(request_id) {
                notify.notify_one();
            }
        }
        Ok(())
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(request_id);
        }
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(request_id);
        }
    }

    pub fn take_cancelled(&self, request_id: &str) -> bool {
        let Ok(mut cancelled) = self.cancelled.lock() else {
            return false;
        };
        cancelled.remove(request_id)
    }
}
