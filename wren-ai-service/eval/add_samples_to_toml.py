# read toml
# utilize utils.get_next_few_items_circular, put n samples in the eval dataset
"""
candidate_eval_dataset.append(
                    {
                        "categories": [],
                        "question": ground_truth["question"],
                        "sql": ground_truth["sql"],
                        "context": context,
                        "document": get_documents_given_contexts(
                            [context], values["mdl"]
                        ),
                        "samples": get_next_few_items_circular(
                            values["ground_truth"], i
                        ),
                    }
                )
"""
# write toml
