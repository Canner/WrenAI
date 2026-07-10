/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

#[cfg(feature = "python-binding")]
mod manifest_python_impl {
    use crate::mdl::manifest::{
        Cube, CubeDimension, Manifest, Measure, Model, RowLevelAccessControl, SessionProperty,
        TimeDimension,
    };
    use crate::mdl::DataSource;
    use pyo3::{pymethods, PyResult};
    use std::sync::Arc;

    #[pymethods]
    impl Manifest {
        #[getter]
        fn layout_version(&self) -> PyResult<u32> {
            Ok(self.layout_version)
        }

        #[getter]
        fn catalog(&self) -> PyResult<String> {
            Ok(self.catalog.clone())
        }

        #[getter]
        fn schema(&self) -> PyResult<String> {
            Ok(self.schema.clone())
        }

        #[getter]
        fn models(&self) -> PyResult<Vec<Model>> {
            Ok(self
                .models
                .iter()
                .map(|m| Arc::unwrap_or_clone(Arc::clone(m)))
                .collect())
        }

        #[getter]
        fn cubes(&self) -> PyResult<Vec<Cube>> {
            Ok(self
                .cubes
                .iter()
                .map(|c| Arc::unwrap_or_clone(Arc::clone(c)))
                .collect())
        }

        #[getter]
        fn data_source(&self) -> PyResult<Option<DataSource>> {
            Ok(self.data_source)
        }

        fn get_model(&self, name: &str) -> PyResult<Option<Model>> {
            let model = self
                .models
                .iter()
                .find(|m| m.name == name)
                .cloned()
                .map(Arc::unwrap_or_clone);
            Ok(model)
        }

        fn get_cube(&self, name: &str) -> PyResult<Option<Cube>> {
            let cube = self
                .cubes
                .iter()
                .find(|c| c.name == name)
                .cloned()
                .map(Arc::unwrap_or_clone);
            Ok(cube)
        }
    }

    #[pymethods]
    impl Cube {
        #[getter]
        fn get_name(&self) -> PyResult<String> {
            Ok(self.name.clone())
        }

        #[getter]
        fn base_object(&self) -> PyResult<String> {
            Ok(self.base_object.clone())
        }

        #[getter]
        fn measures(&self) -> PyResult<Vec<Measure>> {
            Ok(self
                .measures
                .iter()
                .map(|m| Arc::unwrap_or_clone(Arc::clone(m)))
                .collect())
        }

        #[getter]
        fn dimensions(&self) -> PyResult<Vec<CubeDimension>> {
            Ok(self
                .dimensions
                .iter()
                .map(|d| Arc::unwrap_or_clone(Arc::clone(d)))
                .collect())
        }

        #[getter]
        fn time_dimensions(&self) -> PyResult<Vec<TimeDimension>> {
            Ok(self
                .time_dimensions
                .iter()
                .map(|td| Arc::unwrap_or_clone(Arc::clone(td)))
                .collect())
        }

        #[getter]
        fn hierarchies(&self) -> PyResult<std::collections::BTreeMap<String, Vec<String>>> {
            Ok(self.hierarchies.clone())
        }
    }

    #[pymethods]
    impl Measure {
        #[getter]
        fn get_name(&self) -> PyResult<String> {
            Ok(self.name.clone())
        }

        #[getter]
        fn expression(&self) -> PyResult<String> {
            Ok(self.expression.clone())
        }

        #[getter]
        fn r#type(&self) -> PyResult<String> {
            Ok(self.r#type.clone())
        }
    }

    #[pymethods]
    impl CubeDimension {
        #[getter]
        fn get_name(&self) -> PyResult<String> {
            Ok(self.name.clone())
        }

        #[getter]
        fn expression(&self) -> PyResult<String> {
            Ok(self.expression.clone())
        }

        #[getter]
        fn r#type(&self) -> PyResult<String> {
            Ok(self.r#type.clone())
        }
    }

    #[pymethods]
    impl TimeDimension {
        #[getter]
        fn get_name(&self) -> PyResult<String> {
            Ok(self.name.clone())
        }

        #[getter]
        fn expression(&self) -> PyResult<String> {
            Ok(self.expression.clone())
        }

        #[getter]
        fn r#type(&self) -> PyResult<String> {
            Ok(self.r#type.clone())
        }
    }

    #[pymethods]
    impl Model {
        #[getter]
        fn get_name(&self) -> PyResult<String> {
            Ok(self.name.clone())
        }
    }

    #[pymethods]
    impl SessionProperty {
        #[new]
        #[pyo3(signature = (name, required = false, default_expr = None))]
        pub fn new(name: String, required: bool, default_expr: Option<String>) -> Self {
            Self {
                normalized_name: name.to_lowercase(),
                name,
                required,
                default_expr,
            }
        }
    }

    #[pymethods]
    impl RowLevelAccessControl {
        #[new]
        #[pyo3(signature = (name, condition, required_properties = vec![]))]
        fn new(name: String, condition: String, required_properties: Vec<SessionProperty>) -> Self {
            Self {
                name,
                condition,
                required_properties,
            }
        }
    }
}
