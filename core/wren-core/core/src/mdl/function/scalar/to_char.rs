use std::any::Any;

use datafusion::arrow::datatypes::DataType;
use datafusion::common::not_impl_err;
use datafusion::common::types::{
    logical_date, logical_float32, logical_float64, logical_string,
};
use datafusion::error::Result;
use datafusion::logical_expr::TypeSignatureClass;
use datafusion::logical_expr::{
    Coercion, ColumnarValue, DocSection, Documentation, ScalarFunctionArgs,
    ScalarUDFImpl, Signature, TypeSignature, Volatility,
};

#[derive(Debug, PartialEq, Eq, Hash)]
pub struct ToCharFunc {
    signature: Signature,
    aliases: Vec<String>,
    doc: Option<Documentation>,
}

impl Default for ToCharFunc {
    fn default() -> Self {
        Self::new()
    }
}

impl ToCharFunc {
    pub fn new() -> Self {
        Self {
            signature: Signature::one_of(vec![
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Duration), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Interval), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Native(logical_date())), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Time), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Timestamp), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Integer), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Native(logical_float64())), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Coercible(vec![Coercion::new_exact(TypeSignatureClass::Native(logical_float32())), Coercion::new_exact(TypeSignatureClass::Native(logical_string()))]),
                TypeSignature::Exact(vec![DataType::Decimal128(38, 10), DataType::Utf8]),
                TypeSignature::Exact(vec![DataType::Decimal256(38, 10), DataType::Utf8]),
            ], Volatility::Immutable,),
            aliases: vec!["date_format".to_string()],
            doc: Some(Documentation::builder(
                DocSection { include: false, label: "Time and Date Functions", description: None }, 
                "Returns a string representation of a date, time, timestamp or duration based on a [Chrono format](https://docs.rs/chrono/latest/chrono/format/strftime/index.html).",
                "to_char(expression, format)")
                .with_argument("expression", "The date, time, timestamp or duration to format.")
                .with_argument("format", "The [Chrono format](https://docs.rs/chrono/latest/chrono/format/strftime/index.html) string to use for formatting.")
                .build()),
        }
    }
}

impl ScalarUDFImpl for ToCharFunc {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn name(&self) -> &str {
        "to_char"
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Utf8)
    }

    fn invoke_with_args(&self, _args: ScalarFunctionArgs) -> Result<ColumnarValue> {
        not_impl_err!("to_char is not implemented")
    }

    fn aliases(&self) -> &[String] {
        &self.aliases
    }

    fn documentation(&self) -> Option<&Documentation> {
        self.doc.as_ref()
    }
}
