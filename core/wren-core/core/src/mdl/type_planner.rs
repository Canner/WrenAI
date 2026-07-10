use datafusion::{
    arrow::datatypes::{DataType, TimeUnit},
    error::Result,
    logical_expr::planner::TypePlanner,
    sql::sqlparser::ast::DataType as SQLDataType,
};

#[derive(Debug, Clone, Default)]
pub struct WrenTypePlanner {}

impl TypePlanner for WrenTypePlanner {
    fn plan_type(&self, sql_type: &SQLDataType) -> Result<Option<DataType>> {
        match sql_type {
            SQLDataType::Int64 => Ok(Some(DataType::Int64)),
            SQLDataType::Int32 => Ok(Some(DataType::Int32)),
            SQLDataType::Float32 => Ok(Some(DataType::Float32)),
            SQLDataType::Float64 => Ok(Some(DataType::Float64)),
            SQLDataType::Datetime(precision)
                if precision.is_none() || [0, 3, 6, 9].contains(&precision.unwrap()) =>
            {
                let precision = match precision {
                    Some(0) => TimeUnit::Second,
                    Some(3) => TimeUnit::Millisecond,
                    Some(6) => TimeUnit::Microsecond,
                    None | Some(9) => TimeUnit::Nanosecond,
                    _ => unreachable!(),
                };
                Ok(Some(DataType::Timestamp(precision, None)))
            }
            _ => Ok(None),
        }
    }
}
