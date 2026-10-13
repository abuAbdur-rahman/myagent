use std::collections::HashSet;
use std::sync::Mutex;

use crate::error::AppResult;

#[derive(Default)]
pub struct StreamState {
    cancelled: Mutex<HashSet<String>>,
}

impl StreamState {
    pub fn cancel(&self, request_id: &str) -> AppResult<()> {
        let mut set = self.cancelled.lock().map_err(|e| crate::error::AppError::Upstream(e.to_string()))?;
        set.insert(request_id.to_string());
        Ok(())
    }

    pub fn take_cancelled(&self, request_id: &str) -> bool {
        let Ok(mut set) = self.cancelled.lock() else {
            return false;
        };
        set.remove(request_id)
    }
}
