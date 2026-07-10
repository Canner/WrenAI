use std::{error::Error, fmt::Display};

#[derive(Debug, Clone)]
pub enum WrenError {
    PermissionDenied(String),
}

impl Error for WrenError {}

impl Display for WrenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WrenError::PermissionDenied(msg) => write!(f, "Permission Denied: {msg}"),
        }
    }
}
