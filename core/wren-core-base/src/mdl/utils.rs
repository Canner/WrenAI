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

use std::borrow::Cow;

use sqlparser::{ast::Ident, dialect::GenericDialect, parser::Parser};

pub(crate) fn parse_identifiers(s: &str) -> Result<Vec<Ident>, sqlparser::parser::ParserError> {
    let dialect = GenericDialect;
    let mut parser = Parser::new(&dialect).try_with_sql(s)?;
    let idents = parser.parse_multipart_identifier()?;
    Ok(idents)
}

pub(crate) fn parse_identifiers_normalized(
    s: &str,
    ignore_case: bool,
) -> Result<Vec<String>, sqlparser::parser::ParserError> {
    parse_identifiers(s).map(|v| {
        v.into_iter()
            .map(|id| match id.quote_style {
                Some(_) => id.value,
                None if ignore_case => id.value,
                _ => id.value.to_ascii_lowercase(),
            })
            .collect::<Vec<_>>()
    })
}

pub fn quote_identifier(s: &str) -> Cow<'_, str> {
    if needs_quotes(s) {
        Cow::Owned(format!("\"{}\"", s.replace('"', "\"\"")))
    } else {
        Cow::Borrowed(s)
    }
}

/// returns true if this identifier needs quotes
fn needs_quotes(s: &str) -> bool {
    let mut chars = s.chars();

    // first char can not be a number unless escaped
    if let Some(first_char) = chars.next() {
        if !(first_char.is_ascii_lowercase() || first_char == '_') {
            return true;
        }
    }

    !chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}
