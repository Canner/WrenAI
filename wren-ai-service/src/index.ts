import express from 'express';
import cors from 'cors';
import registerRoutes from './routes/index.js';

const app = express();
app.use(express.json());

// allow local Next.js on port 3000
app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: false
}));

app.get('/health', (_req, res) => res.json({ ok: true }));

registerRoutes(app);

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`[wren-ai-service] listening on http://0.0.0.0:${PORT}`);
});
