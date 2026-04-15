import path from 'path';
import { promises as fs } from 'fs';
import axios, { AxiosInstance } from 'axios';
import { getLogger } from '@server/utils';

const logger = getLogger('TrinoAdaptor');
logger.level = 'debug';

export interface EnsureCatalogInput {
  catalogName: string;
  properties: Record<string, string | number | boolean | null | undefined>;
}

type TrinoCatalogManagementMode = 'static' | 'dynamic';

type TrinoStatementResponse = {
  nextUri?: string;
  data?: any[][];
  error?: {
    message?: string;
    errorName?: string;
    errorType?: string;
  };
};

export interface ITrinoAdaptor {
  ensureCatalog(input: EnsureCatalogInput): Promise<void>;
  dropCatalog(catalogName: string): Promise<void>;
  listCatalogs(): Promise<string[]>;
}

export class TrinoAdaptor implements ITrinoAdaptor {
  private readonly catalogDir: string;
  private readonly managementMode: TrinoCatalogManagementMode;
  private readonly runtimeUser?: string;
  private readonly runtimePassword?: string;
  private readonly statementEndpoint?: string;
  private readonly httpClient: AxiosInstance;

  constructor({
    catalogDir,
    managementMode,
    runtimeHost,
    runtimePort,
    runtimeUser,
    runtimePassword,
    runtimeSsl,
    httpClient,
  }: {
    catalogDir: string;
    managementMode?: TrinoCatalogManagementMode;
    runtimeHost?: string;
    runtimePort?: number;
    runtimeUser?: string;
    runtimePassword?: string;
    runtimeSsl?: boolean;
    httpClient?: AxiosInstance;
  }) {
    this.catalogDir = catalogDir;
    this.managementMode = managementMode || 'static';
    this.runtimeUser = runtimeUser;
    this.runtimePassword = runtimePassword;
    this.statementEndpoint =
      this.managementMode === 'dynamic' && runtimeHost && runtimePort
        ? `${runtimeSsl ? 'https' : 'http'}://${runtimeHost}:${runtimePort}/v1/statement`
        : undefined;
    this.httpClient = httpClient || axios.create();
  }

  public async ensureCatalog(input: EnsureCatalogInput): Promise<void> {
    if (this.useDynamicCatalogManagement()) {
      await this.ensureDynamicCatalog(input);
      return;
    }

    await this.ensureCatalogDir();
    const filePath = this.getCatalogFilePath(input.catalogName);
    const content = this.renderProperties(input.properties);
    await fs.writeFile(filePath, content, 'utf8');
    logger.debug(`Ensured Trino catalog file: ${filePath}`);
  }

  public async dropCatalog(catalogName: string): Promise<void> {
    if (this.useDynamicCatalogManagement()) {
      await this.dropDynamicCatalog(catalogName);
      return;
    }

    await this.ensureCatalogDir();
    const filePath = this.getCatalogFilePath(catalogName);
    await fs.rm(filePath, { force: true });
    logger.debug(`Dropped Trino catalog file: ${filePath}`);
  }

  public async listCatalogs(): Promise<string[]> {
    if (this.useDynamicCatalogManagement()) {
      const rows = await this.executeStatement('SHOW CATALOGS');
      return rows
        .map((row) => String(row[0] || '').trim())
        .filter(Boolean)
        .sort();
    }

    await this.ensureCatalogDir();
    const entries = await fs.readdir(this.catalogDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.properties'))
      .map((entry) => entry.name.replace(/\.properties$/, ''))
      .sort();
  }

  private useDynamicCatalogManagement() {
    return this.managementMode === 'dynamic' && Boolean(this.statementEndpoint);
  }

  private async ensureDynamicCatalog(input: EnsureCatalogInput) {
    const connectorName = String(
      input.properties['connector.name'] || '',
    ).trim();
    if (!connectorName) {
      throw new Error(
        `Dynamic Trino catalog ${input.catalogName} is missing connector.name`,
      );
    }

    if (await this.catalogExists(input.catalogName)) {
      await this.executeStatement(
        `DROP CATALOG ${this.quoteIdentifier(input.catalogName)}`,
      );
      await this.waitForCatalogState(input.catalogName, false);
    }

    const withClause = this.renderCatalogWithClause(input.properties);
    await this.executeStatement(
      `CREATE CATALOG ${this.quoteIdentifier(input.catalogName)} USING ${this.renderBareIdentifier(connectorName)}${withClause}`,
    );
    await this.waitForCatalogState(input.catalogName, true);
    logger.debug(`Ensured Trino catalog via SQL: ${input.catalogName}`);
  }

  private async dropDynamicCatalog(catalogName: string) {
    if (!(await this.catalogExists(catalogName))) {
      return;
    }

    await this.executeStatement(
      `DROP CATALOG ${this.quoteIdentifier(catalogName)}`,
    );
    await this.waitForCatalogState(catalogName, false);
    logger.debug(`Dropped Trino catalog via SQL: ${catalogName}`);
  }

  private async catalogExists(catalogName: string) {
    const catalogs = await this.listCatalogs();
    return catalogs.includes(catalogName);
  }

  private async waitForCatalogState(
    catalogName: string,
    expectedExists: boolean,
    attempts = 20,
    delayMs = 500,
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const exists = await this.catalogExists(catalogName);
      if (exists === expectedExists) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(
      `Timed out waiting for Trino catalog ${catalogName} to ${
        expectedExists ? 'appear' : 'disappear'
      }`,
    );
  }

  private async executeStatement(sql: string): Promise<any[][]> {
    if (!this.statementEndpoint || !this.runtimeUser) {
      throw new Error(
        'Dynamic Trino catalog management requires runtime host, port and user',
      );
    }

    let response = (
      await this.httpClient.post<TrinoStatementResponse>(
        this.statementEndpoint,
        sql,
        {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Trino-Source': 'wren-ui',
            'X-Trino-User': this.runtimeUser,
          },
          auth: this.runtimePassword
            ? {
                username: this.runtimeUser,
                password: this.runtimePassword,
              }
            : undefined,
        },
      )
    ).data;

    const rows: any[][] = [];

    while (response) {
      this.throwIfStatementErrored(sql, response);
      if (Array.isArray(response.data)) {
        rows.push(...response.data);
      }

      if (!response.nextUri) {
        break;
      }

      response = (
        await this.httpClient.get<TrinoStatementResponse>(response.nextUri, {
          headers: {
            'X-Trino-Source': 'wren-ui',
            'X-Trino-User': this.runtimeUser,
          },
          auth: this.runtimePassword
            ? {
                username: this.runtimeUser,
                password: this.runtimePassword,
              }
            : undefined,
        })
      ).data;
    }

    return rows;
  }

  private throwIfStatementErrored(
    sql: string,
    response: TrinoStatementResponse,
  ) {
    if (!response.error) {
      return;
    }

    const detail = [
      response.error.errorType,
      response.error.errorName,
      response.error.message,
    ]
      .filter(Boolean)
      .join(': ');

    throw new Error(
      `Trino statement failed for "${sql}": ${detail || 'unknown error'}`,
    );
  }

  private async ensureCatalogDir() {
    await fs.mkdir(this.catalogDir, { recursive: true });
  }

  private getCatalogFilePath(catalogName: string) {
    return path.join(this.catalogDir, `${catalogName}.properties`);
  }

  private renderProperties(
    properties: Record<string, string | number | boolean | null | undefined>,
  ) {
    const normalizedEntries = Object.entries(properties)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) => `${key}=${this.escapePropertyValue(String(value))}`,
      );

    return `${normalizedEntries.join('\n')}\n`;
  }

  private renderCatalogWithClause(
    properties: Record<string, string | number | boolean | null | undefined>,
  ) {
    const renderedEntries = Object.entries(properties)
      .filter(
        ([key, value]) =>
          key !== 'connector.name' && value !== undefined && value !== null,
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, value]) =>
          `${this.quoteIdentifier(key)} = ${this.quoteLiteral(String(value))}`,
      );

    return renderedEntries.length > 0
      ? ` WITH (${renderedEntries.join(', ')})`
      : '';
  }

  private quoteIdentifier(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private renderBareIdentifier(value: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      throw new Error(`Invalid Trino identifier: ${value}`);
    }

    return value;
  }

  private quoteLiteral(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private escapePropertyValue(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  }
}
