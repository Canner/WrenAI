from locust import FastHttpUser, task


class PipelineLoadTest(FastHttpUser):
    @task
    def query_understanding(self):
        self.client.post(
            "/v1/dummy",
            json={
                "query": "What is the capital of France?",
            },
        )
