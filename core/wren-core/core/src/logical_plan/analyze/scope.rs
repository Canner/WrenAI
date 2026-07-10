use crate::mdl::Dataset;
use datafusion::common::internal_err;
use datafusion::error::Result;
use datafusion::prelude::Expr;
use datafusion::sql::TableReference;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt::{Debug, Display};

/// ScopeId is a unique identifier for a scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ScopeId(usize);

impl Display for ScopeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ScopeId({})", self.0)
    }
}

/// [Scope] is used to collect the required columns for models and visited tables in a query scope.
/// A query scope means a full query body containing projection, relation. e.g.
///    SELECT a, b, c FROM table
///
/// To avoid the table name be ambiguous, the relation name should be unique in the scope.
/// The relation of parent scope can be accessed by the child scope.
/// The child scope can also add the required columns to the parent scope.
#[derive(Clone, Debug)]
pub struct Scope {
    /// The unique identifier for the scope
    /// keep it for debugging purposes
    #[allow(dead_code)]
    pub id: ScopeId,
    /// The columns required by the dataset
    pub required_columns: HashMap<TableReference, HashSet<Expr>>,
    /// The Wren dataset visited in the scope (only the Wren dataset)
    pub visited_dataset: HashMap<TableReference, Dataset>,
    /// The table name visited in the scope (not only the Wren dataset)
    pub visited_tables: HashSet<TableReference>,
    /// The parent scope id
    pub parent_id: Option<ScopeId>,
    /// The child scope ids
    pub child_ids: VecDeque<ScopeId>,
}

impl Scope {
    pub fn new_with_id(id: ScopeId) -> Self {
        Self {
            id,
            required_columns: HashMap::new(),
            visited_dataset: HashMap::new(),
            visited_tables: HashSet::new(),
            parent_id: None,
            child_ids: VecDeque::new(),
        }
    }

    pub fn new_child_with_id(id: ScopeId, parent_id: ScopeId) -> Self {
        Self {
            id,
            required_columns: HashMap::new(),
            visited_dataset: HashMap::new(),
            visited_tables: HashSet::new(),
            parent_id: Some(parent_id),
            child_ids: VecDeque::new(),
        }
    }

    pub fn add_visited_dataset(&mut self, table_ref: TableReference, dataset: Dataset) {
        self.visited_dataset.insert(table_ref, dataset);
    }

    pub fn add_visited_table(&mut self, table_ref: TableReference) {
        self.visited_tables.insert(table_ref);
    }

    pub fn push_child_scope(&mut self, scope_id: ScopeId) {
        self.child_ids.push_back(scope_id);
    }

    pub fn pop_child_scope(&mut self) -> Option<ScopeId> {
        self.child_ids.pop_front()
    }
}

#[derive(Debug)]
pub struct ScopeManager {
    scopes: HashMap<ScopeId, Scope>,
    next_id: usize,
    root_id: Option<ScopeId>,
}

impl ScopeManager {
    pub fn new() -> Self {
        Self {
            scopes: HashMap::new(),
            next_id: 0,
            root_id: None,
        }
    }

    pub fn create_root_scope(&mut self) -> ScopeId {
        let id = ScopeId(self.next_id);
        self.next_id += 1;

        let scope = Scope::new_with_id(id);
        self.scopes.insert(id, scope);
        self.root_id = Some(id);
        id
    }

    pub fn create_child_scope(&mut self, parent_id: ScopeId) -> Result<ScopeId> {
        let id = ScopeId(self.next_id);
        self.next_id += 1;

        let scope = Scope::new_child_with_id(id, parent_id);
        self.scopes.insert(id, scope);
        if let Some(parent_scope) = self.scopes.get_mut(&parent_id) {
            parent_scope.push_child_scope(id);
        } else {
            return internal_err!("Parent scope with id {} not found", parent_id);
        }
        Ok(id)
    }

    pub fn get_scope_mut(&mut self, id: ScopeId) -> Result<&mut Scope> {
        if let Some(scope) = self.scopes.get_mut(&id) {
            Ok(scope)
        } else {
            internal_err!("Scope with id {} not found", id)
        }
    }

    /// Adds a required column to the current scope or its parent scopes.
    pub fn add_required_column(
        &mut self,
        scope_id: ScopeId,
        table_ref: TableReference,
        expr: Expr,
    ) -> Result<()> {
        // check if the current scope has visited the table
        if let Some(scope) = self.scopes.get_mut(&scope_id) {
            if scope.visited_dataset.contains_key(&table_ref) {
                scope
                    .required_columns
                    .entry(table_ref.clone())
                    .or_default()
                    .insert(expr);
                return Ok(());
            }
        }

        // if the current scope does not have the table, check the parent scope
        if let Some(scope) = self.scopes.get(&scope_id) {
            if let Some(parent_id) = scope.parent_id {
                if self
                    .add_required_column(parent_id, table_ref.clone(), expr)
                    .is_ok()
                {
                    return Ok(());
                }
            }
        }

        if self.is_table_visited(scope_id, &table_ref) {
            // If the table is visited but the dataset is not found, it could be a subquery alias
            return Ok(());
        }

        // the table is not visited by both the parent and the current scope
        internal_err!("Relation {} isn't visited", table_ref)
    }

    pub fn is_table_visited(
        &self,
        scope_id: ScopeId,
        table_ref: &TableReference,
    ) -> bool {
        if let Some(scope) = self.scopes.get(&scope_id) {
            if scope.visited_tables.contains(table_ref) {
                return true;
            }
            if let Some(parent_id) = scope.parent_id {
                return self.is_table_visited(parent_id, table_ref);
            }
        }
        false
    }

    pub fn try_get_required_columns(
        &self,
        scope_id: ScopeId,
        table_ref: &TableReference,
    ) -> Option<HashSet<Expr>> {
        if let Some(scope) = self.scopes.get(&scope_id) {
            if let Some(columns) = scope.required_columns.get(table_ref) {
                return Some(columns.clone());
            }
            if let Some(parent_id) = scope.parent_id {
                return self.try_get_required_columns(parent_id, table_ref);
            }
        }
        None
    }

    pub fn try_get_visited_dataset(
        &self,
        scope_id: ScopeId,
        table_ref: &TableReference,
    ) -> Option<Dataset> {
        if let Some(scope) = self.scopes.get(&scope_id) {
            if let Some(dataset) = scope.visited_dataset.get(table_ref) {
                return Some(dataset.clone());
            }
            if let Some(parent_id) = scope.parent_id {
                return self.try_get_visited_dataset(parent_id, table_ref);
            }
        }
        None
    }
}
