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
use crate::mdl::dialect::inner_dialect::{get_inner_dialect, InnerDialect};
use crate::mdl::manifest::DataSource;
use datafusion::common::Result;
use datafusion::logical_expr::sqlparser::keywords::ALL_KEYWORDS;
use datafusion::logical_expr::Expr;
use datafusion::scalar::ScalarValue;
use datafusion::sql::sqlparser::ast::{self, WindowFrameBound};
use datafusion::sql::sqlparser::tokenizer::Span;
use datafusion::sql::unparser::dialect::{
    CharacterLengthStyle, DateFieldExtractStyle, Dialect, IntervalStyle,
};
use datafusion::sql::unparser::Unparser;
use regex::Regex;

/// WrenDialect is a dialect for Wren engine. Handle the identifier quote style based on the
/// original Datafusion Dialect implementation but with more strict rules.
/// If the identifier isn't lowercase, it will be quoted.
pub struct WrenDialect {
    inner_dialect: Box<dyn InnerDialect>,
}

impl Dialect for WrenDialect {
    fn identifier_quote_style(&self, identifier: &str) -> Option<char> {
        if let Some(quote) = self.inner_dialect.identifier_quote_style(identifier) {
            return Some(quote);
        }

        let identifier_regex = Regex::new(r"^[a-zA-Z_][a-zA-Z0-9_]*$").unwrap();
        if ALL_KEYWORDS.contains(&identifier.to_uppercase().as_str())
            || !identifier_regex.is_match(identifier)
            || non_lowercase(identifier)
        {
            Some('"')
        } else {
            None
        }
    }

    fn interval_style(&self) -> IntervalStyle {
        IntervalStyle::MySQL
    }

    fn scalar_function_to_sql_overrides(
        &self,
        unparser: &Unparser<'_>,
        func_name: &str,
        args: &[Expr],
    ) -> Result<Option<ast::Expr>> {
        if let Some(function) = self
            .inner_dialect
            .scalar_function_to_sql_overrides(unparser, func_name, args)?
        {
            return Ok(Some(function));
        }

        match func_name {
            "date_part" => {
                date_part_to_sql(unparser, self.date_field_extract_style(), args)
            }
            "character_length" => {
                character_length_to_sql(unparser, self.character_length_style(), args)
            }
            _ => Ok(None),
        }
    }

    fn unnest_as_table_factor(&self) -> bool {
        self.inner_dialect.unnest_as_table_factor()
    }

    fn col_alias_overrides(&self, alias: &str) -> Result<Option<String>> {
        self.inner_dialect.col_alias_overrides(alias)
    }

    fn window_func_support_window_frame(
        &self,
        func_name: &str,
        start_bound: &WindowFrameBound,
        end_bound: &WindowFrameBound,
    ) -> bool {
        if matches!(start_bound, WindowFrameBound::Preceding(None))
            && matches!(end_bound, WindowFrameBound::CurrentRow)
        {
            false
        } else {
            self.inner_dialect.window_func_support_window_frame(
                func_name,
                start_bound,
                end_bound,
            )
        }
    }

    fn date_field_extract_style(&self) -> DateFieldExtractStyle {
        if let Some(style) = self.inner_dialect.date_field_extract_style() {
            style
        } else {
            DateFieldExtractStyle::DatePart
        }
    }
}

impl Default for WrenDialect {
    fn default() -> Self {
        WrenDialect::new(&DataSource::default())
    }
}

impl WrenDialect {
    pub fn new(data_source: &DataSource) -> Self {
        Self {
            inner_dialect: get_inner_dialect(data_source),
        }
    }
}

fn non_lowercase(sql: &str) -> bool {
    let lowercase = sql.to_lowercase();
    lowercase != sql
}

/// Converts a date_part function to SQL, tailoring it to the supported date field extraction style.
pub(crate) fn date_part_to_sql(
    unparser: &Unparser,
    style: DateFieldExtractStyle,
    date_part_args: &[Expr],
) -> Result<Option<ast::Expr>> {
    match (style, date_part_args.len()) {
        (DateFieldExtractStyle::Extract, 2) => {
            let date_expr = unparser.expr_to_sql(&date_part_args[1])?;
            if let Expr::Literal(ScalarValue::Utf8(Some(field)), _) = &date_part_args[0] {
                let field = match field.to_lowercase().as_str() {
                    "year" => ast::DateTimeField::Year,
                    "month" => ast::DateTimeField::Month,
                    "day" => ast::DateTimeField::Day,
                    "hour" => ast::DateTimeField::Hour,
                    "minute" => ast::DateTimeField::Minute,
                    "second" => ast::DateTimeField::Second,
                    "week" => ast::DateTimeField::Week(None),
                    _ => return Ok(None),
                };

                return Ok(Some(ast::Expr::Extract {
                    field,
                    expr: Box::new(date_expr),
                    syntax: ast::ExtractSyntax::From,
                }));
            }
        }
        (DateFieldExtractStyle::Strftime, 2) => {
            let column = unparser.expr_to_sql(&date_part_args[1])?;

            if let Expr::Literal(ScalarValue::Utf8(Some(field)), _) = &date_part_args[0] {
                let field = match field.to_lowercase().as_str() {
                    "year" => "%Y",
                    "month" => "%m",
                    "day" => "%d",
                    "hour" => "%H",
                    "minute" => "%M",
                    "second" => "%S",
                    "week" => "%U",
                    _ => return Ok(None),
                };

                return Ok(Some(ast::Expr::Function(ast::Function {
                    name: ast::ObjectName::from(vec![ast::Ident {
                        value: "strftime".to_string(),
                        quote_style: None,
                        span: Span::empty(),
                    }]),
                    args: ast::FunctionArguments::List(ast::FunctionArgumentList {
                        duplicate_treatment: None,
                        args: vec![
                            ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Expr(
                                ast::Expr::value(ast::Value::SingleQuotedString(
                                    field.to_string(),
                                )),
                            )),
                            ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Expr(column)),
                        ],
                        clauses: vec![],
                    }),
                    filter: None,
                    null_treatment: None,
                    over: None,
                    within_group: vec![],
                    parameters: ast::FunctionArguments::None,
                    uses_odbc_syntax: false,
                })));
            }
        }
        (DateFieldExtractStyle::DatePart, _) => {
            return Ok(Some(
                unparser.scalar_function_to_sql("date_part", date_part_args)?,
            ));
        }
        _ => {}
    };

    Ok(None)
}

pub(crate) fn character_length_to_sql(
    unparser: &Unparser,
    style: CharacterLengthStyle,
    character_length_args: &[Expr],
) -> Result<Option<ast::Expr>> {
    let func_name = match style {
        CharacterLengthStyle::CharacterLength => "character_length",
        CharacterLengthStyle::Length => "length",
    };

    Ok(Some(unparser.scalar_function_to_sql(
        func_name,
        character_length_args,
    )?))
}
