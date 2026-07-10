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
use crate::mdl::manifest::{ColumnLevelAccessControl, NormalizedExpr, NormalizedExprType};
use crate::mdl::ColumnLevelOperator;
use std::fmt::{Display, Formatter};
use std::str::FromStr;

impl ColumnLevelAccessControl {
    /// Evaluate the input against the column level access control.
    /// If the type of the input is different from the type of the value, the result is always false except for NOT_EQUALS.
    pub fn eval(&self, input: &str) -> bool {
        let input_expr = NormalizedExpr::new(input);
        match self.operator {
            ColumnLevelOperator::Equals => input_expr.eq(&self.threshold),
            ColumnLevelOperator::NotEquals => input_expr.neq(&self.threshold),
            ColumnLevelOperator::GreaterThan => input_expr.gt(&self.threshold),
            ColumnLevelOperator::LessThan => input_expr.lt(&self.threshold),
            ColumnLevelOperator::GreaterThanOrEquals => input_expr.gte(&self.threshold),
            ColumnLevelOperator::LessThanOrEquals => input_expr.lte(&self.threshold),
        }
    }
}

impl NormalizedExpr {
    pub fn new(expr: &str) -> Self {
        assert!(!expr.is_empty(), "expr is null or empty");

        if Self::is_string(expr) {
            NormalizedExpr {
                value: expr[1..expr.len() - 1].to_string(),
                data_type: NormalizedExprType::String,
            }
        } else {
            NormalizedExpr {
                value: expr.to_string(),
                data_type: NormalizedExprType::Numeric,
            }
        }
    }

    fn is_string(expr: &str) -> bool {
        expr.starts_with("'") && expr.ends_with("'")
    }

    fn eq(&self, other: &Self) -> bool {
        if self.data_type != other.data_type {
            return false;
        }
        self.value == other.value
    }

    fn neq(&self, other: &Self) -> bool {
        !self.eq(other)
    }

    fn gt(&self, other: &Self) -> bool {
        if self.data_type != other.data_type {
            return false;
        }
        match self.data_type {
            NormalizedExprType::String => self.value > other.value,
            NormalizedExprType::Numeric => {
                self.value.parse::<f64>().unwrap() > other.value.parse::<f64>().unwrap()
            }
        }
    }

    fn lt(&self, other: &Self) -> bool {
        if self.data_type != other.data_type {
            return false;
        }
        match self.data_type {
            NormalizedExprType::String => self.value < other.value,
            NormalizedExprType::Numeric => {
                self.value.parse::<f64>().unwrap() < other.value.parse::<f64>().unwrap()
            }
        }
    }

    fn gte(&self, other: &Self) -> bool {
        self.gt(other) || self.eq(other)
    }

    fn lte(&self, other: &Self) -> bool {
        self.lt(other) || self.eq(other)
    }
}

impl Display for NormalizedExpr {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self.data_type {
            NormalizedExprType::String => write!(f, "'{}'", self.value),
            NormalizedExprType::Numeric => write!(f, "{}", self.value),
        }
    }
}

impl FromStr for NormalizedExpr {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(NormalizedExpr::new(s))
    }
}

#[cfg(test)]
mod test {
    use crate::mdl::manifest::ColumnLevelAccessControl;
    use crate::mdl::{ColumnLevelOperator, NormalizedExpr, SessionProperty};

    #[test]
    #[should_panic(expected = "expr is null or empty")]
    fn test_normalized_expr_with_empty_str() {
        NormalizedExpr::new("");
    }

    fn clac(operator: ColumnLevelOperator, threshold: &str) -> ColumnLevelAccessControl {
        ColumnLevelAccessControl {
            name: "test".to_string(),
            required_properties: vec![SessionProperty::new("p".to_string(), true, None)],
            operator,
            threshold: NormalizedExpr::new(threshold),
        }
    }

    #[test]
    fn test_clac_eval_numeric() {
        assert!(clac(ColumnLevelOperator::Equals, "1").eval("1"));
        assert!(clac(ColumnLevelOperator::NotEquals, "1").eval("2"));
        assert!(clac(ColumnLevelOperator::GreaterThan, "1").eval("2"));
        assert!(clac(ColumnLevelOperator::LessThan, "1").eval("-1"));
        assert!(clac(ColumnLevelOperator::GreaterThanOrEquals, "1").eval("1"));
        assert!(clac(ColumnLevelOperator::LessThanOrEquals, "1").eval("1"));
    }

    #[test]
    fn test_clac_eval_string() {
        assert!(clac(ColumnLevelOperator::Equals, "'b'").eval("'b'"));
        assert!(clac(ColumnLevelOperator::NotEquals, "'b'").eval("'B'"));
        assert!(clac(ColumnLevelOperator::GreaterThan, "'b'").eval("'c'"));
        assert!(clac(ColumnLevelOperator::LessThan, "'b'").eval("'a'"));
        assert!(clac(ColumnLevelOperator::GreaterThanOrEquals, "'b'").eval("'b'"));
        assert!(clac(ColumnLevelOperator::LessThanOrEquals, "'b'").eval("'b'"));
    }

    #[test]
    fn test_clac_eval_type_mismatch() {
        // mismatched types: always false except NotEquals
        assert!(!clac(ColumnLevelOperator::Equals, "1").eval("'1'"));
        assert!(clac(ColumnLevelOperator::NotEquals, "1").eval("'1'"));
        assert!(!clac(ColumnLevelOperator::GreaterThan, "1").eval("'1'"));
        assert!(!clac(ColumnLevelOperator::LessThan, "1").eval("'1'"));
        assert!(!clac(ColumnLevelOperator::GreaterThanOrEquals, "1").eval("'1'"));
        assert!(!clac(ColumnLevelOperator::LessThanOrEquals, "1").eval("'1'"));
    }
}
