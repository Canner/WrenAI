#!/usr/bin/env python3
import json
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


DEPLOY_STATUSES = {}
ASK_TASKS = {}


def normalize_query(value):
    return (value or "").strip().lower()


def build_sql_candidate(query):
    normalized = normalize_query(query)

    if "最近7天" in normalized and "订单量" in normalized:
        return {
            "sql": """
SELECT
  CAST(order_purchase_timestamp AS DATE) AS order_date,
  COUNT(DISTINCT order_id) AS order_count
FROM olist_orders_dataset
WHERE order_purchase_timestamp >= CURRENT_DATE - INTERVAL '6 days'
GROUP BY 1
ORDER BY 1
""".strip(),
            "intent_reasoning": "识别为按天统计最近 7 天订单量趋势的时序分析问题。",
            "sql_generation_reasoning": "使用 orders 表的下单时间按天聚合，并统计去重订单数。",
            "retrieved_tables": ["olist_orders_dataset"],
        }

    if "gmv" in normalized or "支付金额" in normalized:
        return {
            "sql": """
SELECT
  DATE_TRUNC('month', o.order_purchase_timestamp) AS month,
  SUM(p.payment_value) AS gmv
FROM olist_orders_dataset o
JOIN olist_order_payments_dataset p
  ON o.order_id = p.order_id
WHERE o.order_purchase_timestamp >= CURRENT_DATE - INTERVAL '3 months'
GROUP BY 1
ORDER BY 1
""".strip(),
            "intent_reasoning": "识别为围绕成交金额（GMV）的趋势/汇总分析。",
            "sql_generation_reasoning": "关联订单与支付表，并按月汇总支付金额作为 GMV。",
            "retrieved_tables": [
                "olist_orders_dataset",
                "olist_order_payments_dataset",
            ],
        }

    if "城市" in normalized and "订单量" in normalized:
        return {
            "sql": """
SELECT
  c.customer_city,
  COUNT(DISTINCT o.order_id) AS order_count
FROM olist_orders_dataset o
JOIN olist_customers_dataset c
  ON o.customer_id = c.customer_id
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10
""".strip(),
            "intent_reasoning": "识别为城市维度的订单量排行问题。",
            "sql_generation_reasoning": "关联客户与订单表，按城市聚合并按订单量倒序排序。",
            "retrieved_tables": [
                "olist_orders_dataset",
                "olist_customers_dataset",
            ],
        }

    return {
        "sql": """
SELECT
  order_status,
  COUNT(*) AS order_count
FROM olist_orders_dataset
GROUP BY 1
ORDER BY 2 DESC
""".strip(),
        "intent_reasoning": "未命中特定模板，返回一个可执行的订单概览查询作为兜底结果。",
        "sql_generation_reasoning": "使用 orders 表按订单状态做聚合，确保本地 ask 链路可验证。",
        "retrieved_tables": ["olist_orders_dataset"],
    }


def build_ask_result(query):
    candidate = build_sql_candidate(query)
    return {
        "status": "finished",
        "type": "TEXT_TO_SQL",
        "response": [
            {
                "type": "llm",
                "sql": candidate["sql"],
            }
        ],
        "error": None,
        "rephrased_question": query,
        "intent_reasoning": candidate["intent_reasoning"],
        "sql_generation_reasoning": candidate["sql_generation_reasoning"],
        "retrieved_tables": candidate["retrieved_tables"],
        "trace_id": f"stub-trace-{uuid.uuid4().hex[:12]}",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "WrenAIStub/0.2"

    def _send(self, status=200, payload=None, content_type="application/json"):
        if content_type == "application/json":
            body = json.dumps(payload or {}).encode("utf-8")
        else:
            body = (payload or "").encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return {}

    def log_message(self, format, *args):
        return

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/health":
            return self._send(200, {"status": "ok"})

        if path.startswith("/v1/semantics-preparations/") and path.endswith("/status"):
            deploy_id = path.split("/")[3]
            status = DEPLOY_STATUSES.get(deploy_id, "finished")
            return self._send(200, {"status": status})

        if path.startswith("/v1/question-recommendations/"):
            event_id = path.split("/")[3]
            return self._send(200, {"status": "finished", "response": [], "id": event_id})

        if path.startswith("/v1/asks/") and path.endswith("/result"):
            query_id = path.split("/")[3]
            task = ASK_TASKS.get(query_id)
            if not task:
                return self._send(404, {"error": f"Unknown ask task {query_id}"})

            if task["status"] == "stopped":
                return self._send(
                    200,
                    {
                        "status": "stopped",
                        "type": None,
                        "response": [],
                        "error": None,
                    },
                )

            return self._send(200, task["result"])

        if path.startswith("/v1/asks/") and path.endswith("/streaming-result"):
            query_id = path.split("/")[3]
            task = ASK_TASKS.get(query_id)
            if not task:
                return self._send(404, {"error": f"Unknown ask task {query_id}"})

            messages = [
                {"message": "已识别为结构化数据分析问题。"},
                {"message": " 正在生成 SQL 候选结果。"},
                {"done": True},
            ]
            payload = "".join(f"data: {json.dumps(item, ensure_ascii=False)}\n\n" for item in messages)
            return self._send(200, payload, "text/event-stream")

        return self._send(404, {"error": f"Unhandled GET {path}"})

    def do_POST(self):
        path = urlparse(self.path).path
        payload = self._read_json()

        if path == "/v1/semantics-preparations":
            deploy_id = payload.get("id") or payload.get("mdl_hash") or "stub-deploy"
            DEPLOY_STATUSES[deploy_id] = "finished"
            return self._send(200, {"id": deploy_id})

        if path == "/v1/question-recommendations":
            event_id = payload.get("runtime_scope_id") or "stub-question-recommendations"
            return self._send(200, {"id": event_id})

        if path == "/v1/asks":
            query = payload.get("query") or "未命名问题"
            query_id = f"ask-{uuid.uuid4().hex[:12]}"
            ASK_TASKS[query_id] = {
                "query": query,
                "status": "finished",
                "result": build_ask_result(query),
            }
            return self._send(200, {"query_id": query_id})

        return self._send(404, {"error": f"Unhandled POST {path}"})

    def do_PATCH(self):
        path = urlparse(self.path).path
        payload = self._read_json()

        if path.startswith("/v1/asks/"):
            query_id = path.split("/")[3]
            task = ASK_TASKS.get(query_id)
            if not task:
                return self._send(404, {"error": f"Unknown ask task {query_id}"})

            if payload.get("status") == "stopped":
                task["status"] = "stopped"
            return self._send(200, {"ok": True})

        return self._send(404, {"error": f"Unhandled PATCH {path}"})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/v1/semantics":
            return self._send(200, {"ok": True})
        return self._send(404, {"error": f"Unhandled DELETE {path}"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5555), Handler)
    print("wren_ai_stub listening on http://127.0.0.1:5555", flush=True)
    server.serve_forever()
