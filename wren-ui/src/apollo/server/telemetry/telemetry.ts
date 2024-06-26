import { getConfig } from '../config';
import { PostHog } from 'posthog-node';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '@server/utils';

const logger = getLogger('TELEMETRY');
logger.level = 'debug';

const config = getConfig();

const {
  userUUID,
  telemetryEnabled,
  wrenAIVersion,
  generationModel,
  wrenEngineVersion,
  wrenUIVersion,
  posthogApiKey,
  posthogHost,
} = config;

export class Telemetry {
  private readonly posthog: any;
  private readonly userId: string;

  constructor() {
    if (telemetryEnabled) {
      if (!posthogApiKey) {
        logger.debug('Telemetry enabled but posthogApiKey not provided.');
        return;
      }
      const client = new PostHog(posthogApiKey, {
        host: posthogHost || 'https://us.posthog.com',
      });
      this.posthog = client;
      this.userId = userUUID || uuidv4();
      logger.info('Telemetry initialized');
      return;
    }
    logger.info('Telemetry not enabled.');
  }

  public async send_event(event: string, properties: Record<string, any> = {}) {
    if (!this.posthog) {
      return;
    }
    try {
      const systemInfo = this.collectSystemInfo();
      this.posthog.capture({
        distinctId: this.userId,
        event,
        properties: {
          ...systemInfo,
          ...properties,
        },
      });
    } catch (e) {
      logger.error(e);
    }
  }

  private collectSystemInfo(): Record<string, any> {
    return {
      // collect services version
      'wren-ui-version': wrenUIVersion || null,
      'wren-engine-version': wrenEngineVersion || null,
      'wren-ai-service-version': wrenAIVersion || null,

      // collect AI model info
      'generation-model': generationModel || null,

      // collect some system info from process module
      node_version: process.version,
      node_platform: process.platform,
      node_arch: process.arch,
      memory_usage: process.memoryUsage(),
      cpu_usage: process.cpuUsage(),
    };
  }

  public stop() {
    if (this.posthog) {
      this.posthog.shutdown();
    }
  }
}
