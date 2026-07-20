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
            SQLDataType::Datetime(precision) => {
                let p = precision.unwrap_or(9);
                if [0, 3, 6, 9].contains(&p) {
                    let time_unit = match p {
                        0 => TimeUnit::Second,
                        3 => TimeUnit::Millisecond,
                        6 => TimeUnit::Microsecond,
                        _ => TimeUnit::Nanosecond,
                    };
                    Ok(Some(DataType::Timestamp(time_unit, None)))
                } else {
                    Ok(None)
                }
            }
            _ => Ok(None),
        }
    }
}
