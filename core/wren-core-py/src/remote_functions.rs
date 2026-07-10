// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

use pyo3::prelude::PyDictMethods;
use pyo3::types::PyDict;
use pyo3::{pyclass, pymethods, Py, PyAny, Python};
use serde::{Deserialize, Serialize};
use std::fmt::Display;
use std::str::FromStr;
use wren_core::mdl::function::FunctionType;

#[pyclass(name = "RemoteFunction")]
#[derive(Serialize, Deserialize, Clone, Eq, PartialEq, Hash, Debug)]
pub struct PyRemoteFunction {
    #[pyo3(get)]
    pub function_type: String,
    #[pyo3(get)]
    pub name: String,
    #[pyo3(get)]
    pub return_type: Option<String>,
    /// It's a comma separated string of parameter names
    #[pyo3(get)]
    pub param_names: Option<String>,
    /// It's a comma separated string of parameter types
    #[pyo3(get)]
    pub param_types: Option<String>,
    #[pyo3(get)]
    pub description: Option<String>,
}

#[pymethods]
impl PyRemoteFunction {
    pub fn to_dict(&self, py: Python) -> Py<PyAny> {
        let dict = PyDict::new(py);
        dict.set_item("function_type", self.function_type.clone())
            .unwrap();
        dict.set_item("name", self.name.clone()).unwrap();
        dict.set_item("return_type", self.return_type.clone())
            .unwrap();
        dict.set_item("param_names", self.param_names.clone())
            .unwrap();
        dict.set_item("param_types", self.param_types.clone())
            .unwrap();
        dict.set_item("description", self.description.clone())
            .unwrap();
        dict.into()
    }
}

impl From<wren_core::mdl::function::RemoteFunction> for PyRemoteFunction {
    fn from(remote_function: wren_core::mdl::function::RemoteFunction) -> Self {
        let param_names = remote_function
            .param_names
            .map(|names| {
                names
                    .into_iter()
                    .flatten()
                    .collect::<Vec<String>>()
                    .join(",")
            })
            .and_then(|types| if types.is_empty() { None } else { Some(types) });
        let param_types = remote_function
            .param_types
            .map(|types| {
                types
                    .into_iter()
                    .flatten()
                    .collect::<Vec<String>>()
                    .join(",")
            })
            .and_then(|types| if types.is_empty() { None } else { Some(types) });
        let return_type = if remote_function.return_type.is_empty() {
            None
        } else {
            Some(remote_function.return_type)
        };
        Self {
            function_type: remote_function.function_type.to_string(),
            name: remote_function.name,
            return_type,
            param_names,
            param_types,
            description: remote_function.description,
        }
    }
}

impl From<PyRemoteFunction> for wren_core::mdl::function::RemoteFunction {
    fn from(
        remote_function: PyRemoteFunction,
    ) -> wren_core::mdl::function::RemoteFunction {
        let param_names = remote_function.param_names.map(|names| {
            names
                .split(",")
                .map(|name| {
                    if name.is_empty() {
                        None
                    } else {
                        Some(name.to_string())
                    }
                })
                .collect::<Vec<Option<String>>>()
        });
        let param_types = remote_function.param_types.map(|types| {
            types
                .split(",")
                .map(|t| {
                    if t.is_empty() {
                        None
                    } else {
                        Some(t.to_string())
                    }
                })
                .collect::<Vec<Option<String>>>()
        });
        wren_core::mdl::function::RemoteFunction {
            function_type: FunctionType::from_str(&remote_function.function_type)
                .unwrap(),
            name: remote_function.name,
            return_type: remote_function.return_type.unwrap_or("string".to_string()),
            param_names,
            param_types,
            description: remote_function.description,
        }
    }
}

impl Display for PyRemoteFunction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "RemoteFunction {{ function_type: {}, name: {}, return_type: {:?}, param_names: {:?}, param_types: {:?}, description: {:?} }}",
            self.function_type,
            self.name,
            self.return_type,
            self.param_names,
            self.param_types,
            self.description
        )
    }
}
