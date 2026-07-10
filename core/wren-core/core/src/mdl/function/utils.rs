use datafusion::logical_expr::{DocSection, Documentation, DocumentationBuilder};

pub fn build_document(desc: &str, example: &str) -> Documentation {
    DocumentationBuilder::new_with_details(DocSection::default(), desc, example).build()
}
