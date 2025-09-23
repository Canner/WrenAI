import fetch from 'node-fetch';

interface OpenAIOpts {
  apiKey: string;
  model: string;
}

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

type OpenAIResp = {
  choices?: Array<{ message?: ChatMsg }>;
};

export function getOpenAiClient(opts: OpenAIOpts) {
  return {
    async generate(prompt: string): Promise<string> {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: 'system', content: 'You are a helpful data analyst.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2
        })
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`OpenAI error: ${resp.status} ${text}`);
      }

      const data = (await resp.json()) as OpenAIResp;
      return (data.choices?.[0]?.message?.content ?? '').trim();
    }
  };
}
