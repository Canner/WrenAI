import { DataSourceName } from '@/types/dataSource';
import {
  buildKnowledgeConnectionSettingsUrl,
  normalizeSettingsData,
  resolveSettingsConnection,
} from './settingsRest';
import { buildKnowledgeConnectionSaveUrl } from './modelingRest';

describe('knowledge connection REST helpers', () => {
  it('uses the connector-oriented settings endpoint', () => {
    expect(buildKnowledgeConnectionSettingsUrl()).toBe(
      '/api/v1/settings/connection',
    );
    expect(buildKnowledgeConnectionSaveUrl()).toBe(
      '/api/v1/settings/connection',
    );
  });

  it('keeps connection payloads on the connector-oriented field', () => {
    const normalized = normalizeSettingsData({
      productVersion: '1.0.0',
      connection: {
        type: DataSourceName.POSTGRES,
        properties: { host: 'db' },
        sampleDataset: null,
      },
    });

    expect(resolveSettingsConnection(normalized)).toEqual({
      type: DataSourceName.POSTGRES,
      properties: { host: 'db' },
      sampleDataset: null,
    });
    expect(normalized?.connection).toEqual({
      type: DataSourceName.POSTGRES,
      properties: { host: 'db' },
      sampleDataset: null,
    });
  });
});
