import { Express } from 'express';
import insightsRouter from './insights.js';

export default function registerRoutes(app: Express) {
  const insightsEnabled = String(process.env.INSIGHTS_ENABLED ?? 'true').toLowerCase() === 'true';
  if (insightsEnabled) {
    app.use('/insights', insightsRouter);
  }
}
