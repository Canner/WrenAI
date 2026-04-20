import { Connector } from '../repositories';
import { DataSourceName } from '../types';
import { CompactTable } from './metadataService';
import { SecretPayload } from './secretService';

export interface CreateConnectorInput {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  type: string;
  databaseProvider?: string | null;
  displayName: string;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
  createdBy?: string | null;
}

export interface UpdateConnectorInput {
  knowledgeBaseId?: string | null;
  type?: string;
  databaseProvider?: string | null;
  displayName?: string;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
}

export interface ResolvedConnector extends Connector {
  secret: SecretPayload | null;
}

export interface TestConnectorConnectionInput {
  workspaceId: string;
  knowledgeBaseId?: string | null;
  connectorId?: string;
  type?: string;
  databaseProvider?: string | null;
  config?: Record<string, any> | null;
  secret?: SecretPayload | null;
}

export interface ConnectorConnectionTestResult {
  success: true;
  message: string;
  connectorType: string;
  connectionType?: DataSourceName;
  tableCount?: number;
  sampleTables?: string[];
  version?: string | null;
}

export interface IConnectorService {
  createConnector(input: CreateConnectorInput): Promise<Connector>;
  updateConnector(
    connectorId: string,
    input: UpdateConnectorInput,
  ): Promise<Connector>;
  getConnectorById(connectorId: string): Promise<Connector | null>;
  listConnectorTables(
    workspaceId: string,
    connectorId: string,
  ): Promise<CompactTable[]>;
  listConnectorsByKnowledgeBase(
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<Connector[]>;
  deleteConnector(connectorId: string): Promise<void>;
  resolveConnectorSecret(connectorId: string): Promise<SecretPayload | null>;
  getResolvedConnector(connectorId: string): Promise<ResolvedConnector | null>;
  testConnectorConnection(
    input: TestConnectorConnectionInput,
  ): Promise<ConnectorConnectionTestResult>;
}
