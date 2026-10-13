use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct StreamState {
    active: Mutex<HashMap<String, Arc<Notify>>>,
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
        if let Some(notify) = self
            .active
            .lock()
            .map_err(|_| poisoned("stream registry"))?
            .get(request_id)
        {
            notify.notify_one();
        }
        Ok(())
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(request_id);
        }
    }
}
