import { Router } from 'express';
import { createInsights } from '../services/insights.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { sql, rows, columns } = req.body || {};
    const result = await createInsights({ sql, rows, columns });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
});

export default router;
