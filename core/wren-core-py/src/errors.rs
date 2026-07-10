use base64::DecodeError;
use pyo3::exceptions::PyException;
use pyo3::PyErr;
use std::num::ParseIntError;
use std::string::FromUtf8Error;
use thiserror::Error;
use wren_core::DataFusionError;
use wren_core::WrenError;
use wren_core_base::mdl::ParsedDataSourceError;

#[derive(Error, Debug, PartialEq)]
#[error("{message}")]
pub struct CoreError {
    message: String,
}

impl CoreError {
    pub fn new(msg: &str) -> CoreError {
        CoreError {
            message: msg.to_string(),
        }
    }
}

impl From<CoreError> for PyErr {
    fn from(err: CoreError) -> Self {
        PyException::new_err(err.to_string())
    }
}

impl From<PyErr> for CoreError {
    fn from(err: PyErr) -> Self {
        CoreError::new(&format!("PyError: {}", &err))
    }
}

impl From<DecodeError> for CoreError {
    fn from(err: DecodeError) -> Self {
        CoreError::new(&format!("Base64 decode error: {}", err))
    }
}

impl From<FromUtf8Error> for CoreError {
    fn from(err: FromUtf8Error) -> Self {
        CoreError::new(&format!("FromUtf8Error: {}", err))
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(err: serde_json::Error) -> Self {
        CoreError::new(&format!("Serde JSON error: {}", err))
    }
}

impl From<DataFusionError> for CoreError {
    fn from(err: DataFusionError) -> Self {
        if let DataFusionError::Context(_, ee) = &err {
            if let DataFusionError::External(we) = ee.as_ref() {
                if let Some(we) = we.downcast_ref::<WrenError>() {
                    return CoreError::new(we.to_string().as_str());
                }
            }
        }
        CoreError::new(err.to_string().as_str())
    }
}

impl From<wren_core::parser::ParserError> for CoreError {
    fn from(err: wren_core::parser::ParserError) -> Self {
        CoreError::new(&format!("Parser error: {}", err))
    }
}

impl From<ParseIntError> for CoreError {
    fn from(err: ParseIntError) -> Self {
        CoreError::new(&format!("ParseIntError: {}", err))
    }
}

impl From<csv::Error> for CoreError {
    fn from(err: csv::Error) -> Self {
        CoreError::new(&format!("CSV error: {}", err))
    }
}

impl From<std::io::Error> for CoreError {
    fn from(err: std::io::Error) -> Self {
        CoreError::new(&format!("IO error: {}", err))
    }
}

impl From<ParsedDataSourceError> for CoreError {
    fn from(err: ParsedDataSourceError) -> Self {
        CoreError::new(&format!("DataSource error: {}", err))
    }
}
