import dspy


class AskGenerationSignatureV1(dspy.Signature):
    """Given a user query that is ambiguous in nature, your task is to interpret the query in various plausible ways and \
generate three SQL statements that could potentially answer each interpreted version of the queries and within-10-words summary. \
Provide three different interpretations and corresponding SQL queries that reflect these interpretations. \
Ensure that your SQL queries are diverse, covering a range of possible meanings behind the ambiguous query. \

The output should be in the following JSON format:

{
    "results": [
        {"sql": <SQL_QUERY_STRING_1>, "summary": <SUMMARY_STRING_1>},
        {"sql": <SQL_QUERY_STRING2>, "summary": <SUMMARY_STRING_2>},
        {"sql": <SQL_QUERY_STRING3>, "summary": <SUMMARY_STRING_3>}
    ]
}
"""

    question = dspy.InputField()
    context = dspy.InputField(description="List of database schema documents")
    answer = dspy.OutputField()


class AskGenerationV1(dspy.Module):
    def __init__(self):
        super().__init__()
        self.generate_answer = dspy.ChainOfThought(AskGenerationSignatureV1)

    def forward(self, question, context):
        prediction = self.generate_answer(question=question, context=context)
        return dspy.Prediction(context=context, answer=prediction.answer)
