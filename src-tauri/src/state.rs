use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tokio::sync::{Notify, oneshot};

use crate::error::{AppError, AppResult};
use crate::permissions::ApprovalReply;

pub struct PendingApproval {
    pub action: String,
    pub resources: Vec<String>,
    pub project_id: Option<String>,
    pub tx: oneshot::Sender<ApprovalReply>,
}

#[derive(Default)]
pub struct StreamState {
    active: Mutex<HashMap<String, Arc<Notify>>>,
    cancelled: Mutex<HashSet<String>>,
    pending: Mutex<HashMap<String, PendingApproval>>,
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
        self.fail_pending_for_request(request_id);
    }

    pub fn take_cancelled(&self, request_id: &str) -> bool {
        let Ok(mut cancelled) = self.cancelled.lock() else {
            return false;
        };
        cancelled.remove(request_id)
    }

    pub fn insert_pending(&self, key: &str, pending: PendingApproval) -> AppResult<()> {
        self.pending
            .lock()
            .map_err(|_| poisoned("approval registry"))?
            .insert(key.to_string(), pending);
        Ok(())
    }

    pub fn take_pending(&self, key: &str) -> Option<PendingApproval> {
        self.pending.lock().ok()?.remove(key)
    }

    pub fn fail_pending_for_request(&self, request_id: &str) {
        let prefix = format!("{request_id}:");
        let Ok(mut pending) = self.pending.lock() else {
            return;
        };
        let keys: Vec<String> = pending
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in keys {
            if let Some(item) = pending.remove(&key) {
                let _ = item.tx.send(ApprovalReply::Deny);
            }
        }
    }
}
