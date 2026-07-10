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
use datafusion::common::Result;
use datafusion::logical_expr::Expr;
use datafusion::sql::sqlparser::ast::{self, ObjectNamePart};
use datafusion::sql::sqlparser::ast::{Function, Ident, ObjectName};
use datafusion::sql::sqlparser::tokenizer::Span;
use datafusion::sql::unparser::Unparser;

pub(crate) fn function_args_to_sql(
    unparser: &Unparser,
    args: &[Expr],
) -> Result<Vec<ast::FunctionArg>> {
    args.iter()
        .map(|e| {
            // TODO: remove deprecated wildcard
            #[allow(deprecated)]
            if matches!(
                e,
                Expr::Wildcard {
                    qualifier: None,
                    ..
                }
            ) {
                Ok(ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Wildcard))
            } else {
                unparser
                    .expr_to_sql(e)
                    .map(|e| ast::FunctionArg::Unnamed(ast::FunctionArgExpr::Expr(e)))
            }
        })
        .collect::<Result<Vec<_>>>()
}

pub(crate) fn scalar_function_to_sql_internal(
    unparser: &Unparser,
    _schema_name: Option<&str>,
    func_name: &str,
    args: &[Expr],
) -> Result<Option<ast::Expr>> {
    let args = function_args_to_sql(unparser, args)?;
    Ok(Some(ast::Expr::Function(Function {
        name: ObjectName(vec![ObjectNamePart::Identifier(Ident {
            value: func_name.to_string(),
            quote_style: None,
            span: Span::empty(),
        })]),
        args: ast::FunctionArguments::List(ast::FunctionArgumentList {
            duplicate_treatment: None,
            args,
            clauses: vec![],
        }),
        filter: None,
        null_treatment: None,
        over: None,
        within_group: vec![],
        parameters: ast::FunctionArguments::None,
        uses_odbc_syntax: false,
    })))
}
