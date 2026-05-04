import type { NextApiRequest, NextApiResponse } from 'next';
import { getConfig } from '@/apollo/server/config';

export default function handler(_: NextApiRequest, res: NextApiResponse) {
  const config = getConfig();
  const encodedTelemetryKey = config.posthogApiKey
    ? Buffer.from(config.posthogApiKey).toString('base64')
    : '';

  res.status(200).json({
    isTelemetryEnabled: config.telemetryEnabled || false,
    telemetryKey: encodedTelemetryKey,
    telemetryHost: config.posthogHost || '',
    userUUID: config.userUUID || '',
  });
}
