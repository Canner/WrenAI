# WrenAI Starter: OpenAI Text-to-SQL + Local Insights (Ollama)

## Steps
1) Fork & clone your WrenAI repo; checkout a new branch:
   ```bash
   git submodule update --init --recursive
   git checkout -b feat/local-ollama-insights
   ```
2) Copy `.env.example` to `.env` and fill in your `OPENAI_API_KEY`.
3) Ensure Ollama is running:
   ```bash
   ollama pull llama3.1:8b
   ollama serve
   ```
4) Drop the `wren-ai-service/src/**` files into your repo (create folders if missing).
5) Apply the two patch hints (`*.PATCH.txt`) to the existing files in your codebase.
   - `wren-ai-service/src/providers/llm/index.ts.PATCH.txt`
   - `wren-ai-service/src/routes/index.ts.PATCH.txt`
6) Build & run:
   ```bash
   docker compose build
   docker compose up -d
   ```
7) Test:
   ```bash
   curl -X POST http://localhost:7000/insights          -H 'Content-Type: application/json'          -d '{"sql":"select * from sales limit 5;","columns":["id","amount"],"rows":[{"id":1,"amount":100}]}'
   ```

## Notes
- Toggle insights: set `INSIGHTS_ENABLED=false` in `.env`.
- Use a smaller local model if needed: `INSIGHTS_OLLAMA_MODEL=llama3.2:3b-instruct`.
