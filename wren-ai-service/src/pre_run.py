from src.utils import init_providers

# in order to prevent from multiple qdrant document store initialization that may cause "collection already exists error"
# this error is caused by the fact that we may run multiple workers concurrently
_, document_store_provider = init_providers()
document_store_provider.get_store()
document_store_provider.get_store(dataset_name="view_questions")
