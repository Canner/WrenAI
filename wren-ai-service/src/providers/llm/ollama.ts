import fetch from 'node-fetch';

type OllamaGenerateResp = {
  response?: string;
  // stream mode has different fields; we don't use it here
};

export class OllamaClient {
  constructor(private baseUrl: string, private model: string) {}

  async generate(prompt: string): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, stream: false })
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Ollama error: ${resp.status} ${text}`);
    }

    const data = (await resp.json()) as OllamaGenerateResp;
    return (data.response ?? '').trim();
  }
}
