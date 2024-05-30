from locust import FastHttpUser, task


class SemanticsDescriptionsUser(FastHttpUser):
    @task
    def bulk_generate_description(self):
        self.client.post(
            "/v1/semantics-descriptions",
            json={
                "mdl": {
                    "name": "all_star",
                    "properties": {},
                    "refsql": 'select * from "canner-cml".spider."baseball_1-all_star"',
                    "columns": [
                        {
                            "name": "player_id",
                            "type": "varchar",
                            "notnull": False,
                            "iscalculated": False,
                            "expression": "player_id",
                            "properties": {},
                        }
                    ],
                    "primarykey": "",
                },
                "model": "all_star",
                "identifiers": [
                    "model",
                ],
            },
        )
