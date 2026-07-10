use crate::mdl::manifest::Model;
use crate::mdl::utils::{quoted, to_field, to_remote_field};
use crate::mdl::{RegisterTables, SessionStateRef};
use datafusion::arrow::datatypes::Field;
use datafusion::common::DFSchema;
use datafusion::common::Result;
use std::fmt::Display;
use std::sync::Arc;

#[derive(PartialEq, Eq, Hash, Debug, Clone)]
pub enum Dataset {
    Model(Arc<Model>),
}

impl Dataset {
    pub fn name(&self) -> &str {
        match self {
            Dataset::Model(model) => model.name(),
        }
    }

    pub fn try_as_model(&self) -> Option<Arc<Model>> {
        match self {
            Dataset::Model(model) => Some(Arc::clone(model)),
        }
    }

    pub fn to_qualified_schema(&self, show_visible_only: bool) -> Result<DFSchema> {
        match self {
            Dataset::Model(model) => {
                let fields: Vec<_> = model
                    .get_physical_columns(show_visible_only)
                    .iter()
                    .map(|c| to_field(c))
                    .collect::<Result<_>>()?;
                let arrow_schema = datafusion::arrow::datatypes::Schema::new(fields);
                DFSchema::try_from_qualified_schema(quoted(&model.name), &arrow_schema)
            }
        }
    }

    /// Create the schema with the remote table name
    pub fn to_remote_schema(
        &self,
        register_tables: Option<&RegisterTables>,
        session_state: SessionStateRef,
    ) -> Result<DFSchema> {
        match self {
            Dataset::Model(model) => {
                // For refSql models, use the model name as qualifier
                let qualifier = model
                    .table_reference()
                    .map(|t| t.to_string())
                    .unwrap_or_else(|| quoted(model.name()));

                let schema = register_tables
                    .map(|rt| rt.get(&qualifier))
                    .filter(|rt| rt.is_some())
                    .map(|rt| rt.unwrap().schema());

                if let Some(schema) = schema {
                    DFSchema::try_from_qualified_schema(qualifier.as_str(), &schema)
                } else {
                    let fields: Vec<Field> = model
                        .get_physical_columns(true)
                        .iter()
                        .filter(|c| !c.is_calculated)
                        .map(|c| to_remote_field(c, Arc::clone(&session_state)))
                        .collect::<Result<Vec<Vec<Field>>>>()?
                        .iter()
                        .flat_map(|c| c.clone())
                        .collect();
                    let arrow_schema = datafusion::arrow::datatypes::Schema::new(fields);

                    DFSchema::try_from_qualified_schema(qualifier.as_str(), &arrow_schema)
                }
            }
        }
    }
}

impl Display for Dataset {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Dataset::Model(model) => write!(f, "{}", model.name()),
        }
    }
}
