/* eslint-disable @typescript-eslint/no-var-requires */
const migration = require('../../migrations/20260410122000_drop_legacy_skill_binding');

const buildTableRecorder = () => {
  const operations = {
    columns: [],
    foreigns: [],
    indexes: [],
    timestamps: [],
  };

  const buildColumnBuilder = (column) => ({
    primary: jest.fn(() => {
      column.primary = true;
      return buildColumnBuilder(column);
    }),
    notNullable: jest.fn(() => {
      column.notNullable = true;
      return buildColumnBuilder(column);
    }),
    nullable: jest.fn(() => {
      column.nullable = true;
      return buildColumnBuilder(column);
    }),
    defaultTo: jest.fn((value) => {
      column.defaultTo = value;
      return buildColumnBuilder(column);
    }),
  });

  const buildForeignBuilder = (foreign) => ({
    references: jest.fn((value) => {
      foreign.references = value;
      return buildForeignBuilder(foreign);
    }),
    inTable: jest.fn((value) => {
      foreign.inTable = value;
      return buildForeignBuilder(foreign);
    }),
    onDelete: jest.fn((value) => {
      foreign.onDelete = value;
      return buildForeignBuilder(foreign);
    }),
  });

  const table = {
    string: jest.fn((name) => {
      const column = { type: 'string', name };
      operations.columns.push(column);
      return buildColumnBuilder(column);
    }),
    jsonb: jest.fn((name) => {
      const column = { type: 'jsonb', name };
      operations.columns.push(column);
      return buildColumnBuilder(column);
    }),
    boolean: jest.fn((name) => {
      const column = { type: 'boolean', name };
      operations.columns.push(column);
      return buildColumnBuilder(column);
    }),
    timestamps: jest.fn((useTz, defaultToNow) => {
      operations.timestamps.push({ useTz, defaultToNow });
    }),
    foreign: jest.fn((name) => {
      const foreign = { name };
      operations.foreigns.push(foreign);
      return buildForeignBuilder(foreign);
    }),
    index: jest.fn((columns) => {
      operations.indexes.push(columns);
    }),
  };

  return { operations, table };
};

const buildKnex = ({
  hasTable = true,
  hasColumn = true,
  rawCounts = [],
} = {}) => {
  const { operations, table } = buildTableRecorder();
  const schema = {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    hasColumn: jest.fn().mockResolvedValue(hasColumn),
    dropTable: jest.fn().mockResolvedValue(undefined),
    createTable: jest.fn(async (_name, callback) => {
      callback(table);
    }),
  };
  const pendingCounts = [...rawCounts];
  const raw = jest.fn(async (sql) => {
    if (
      typeof sql === 'string' &&
      sql.includes('COMMENT ON TABLE skill_binding')
    ) {
      return { rows: [] };
    }

    if (pendingCounts.length === 0) {
      throw new Error(`Unexpected raw SQL: ${sql}`);
    }

    return { rows: [{ count: String(pendingCounts.shift()) }] };
  });

  return {
    knex: { schema, raw },
    schema,
    raw,
    operations,
  };
};

describe('20260410122000_drop_legacy_skill_binding migration', () => {
  it('skips up when skill_binding table is already absent', async () => {
    const { knex, schema, raw } = buildKnex({ hasTable: false });

    await migration.up(knex);

    expect(schema.hasTable).toHaveBeenCalledWith('skill_binding');
    expect(schema.hasColumn).not.toHaveBeenCalled();
    expect(raw).not.toHaveBeenCalled();
    expect(schema.dropTable).not.toHaveBeenCalled();
  });

  it('fails up when migration_source_binding_id column is missing', async () => {
    const { knex, schema } = buildKnex({ hasColumn: false });

    await expect(migration.up(knex)).rejects.toThrow(
      'Cannot drop skill_binding before skill_definition.migration_source_binding_id exists.',
    );
    expect(schema.hasColumn).toHaveBeenCalledWith(
      'skill_definition',
      'migration_source_binding_id',
    );
    expect(schema.dropTable).not.toHaveBeenCalled();
  });

  it('fails up when migrated source binding ids are duplicated', async () => {
    const { knex, schema, raw } = buildKnex({ rawCounts: [2] });

    await expect(migration.up(knex)).rejects.toThrow(
      'Cannot drop skill_binding: found 2 duplicated migration_source_binding_id values in skill_definition.',
    );
    expect(raw).toHaveBeenCalledTimes(1);
    expect(schema.dropTable).not.toHaveBeenCalled();
  });

  it('fails up when multi-binding groups were not fully materialized', async () => {
    const { knex, schema, raw } = buildKnex({ rawCounts: [0, 1] });

    await expect(migration.up(knex)).rejects.toThrow(
      'Cannot drop skill_binding: found 1 skill definitions whose legacy binding groups have not been fully materialized into runtime skills.',
    );
    expect(raw).toHaveBeenCalledTimes(2);
    expect(schema.dropTable).not.toHaveBeenCalled();
  });

  it('fails up when runtime settings were not backfilled to skill_definition', async () => {
    const { knex, schema, raw } = buildKnex({ rawCounts: [0, 0, 3] });

    await expect(migration.up(knex)).rejects.toThrow(
      'Cannot drop skill_binding: found 3 skill definitions with legacy bindings but missing runtime settings on skill_definition.',
    );
    expect(raw).toHaveBeenCalledTimes(3);
    expect(schema.dropTable).not.toHaveBeenCalled();
  });

  it('drops skill_binding only after every retirement gate passes', async () => {
    const { knex, schema, raw } = buildKnex({ rawCounts: [0, 0, 0] });

    await migration.up(knex);

    expect(raw).toHaveBeenCalledTimes(3);
    expect(schema.dropTable).toHaveBeenCalledWith('skill_binding');
  });

  it('skips down when skill_binding table already exists', async () => {
    const { knex, schema, raw } = buildKnex({ hasTable: true });

    await migration.down(knex);

    expect(schema.hasTable).toHaveBeenCalledWith('skill_binding');
    expect(schema.createTable).not.toHaveBeenCalled();
    expect(raw).not.toHaveBeenCalled();
  });

  it('recreates an empty legacy skill_binding table on down', async () => {
    const { knex, schema, raw, operations } = buildKnex({ hasTable: false });

    await migration.down(knex);

    expect(schema.createTable).toHaveBeenCalledWith(
      'skill_binding',
      expect.any(Function),
    );
    expect(operations.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'string', name: 'id', primary: true }),
        expect.objectContaining({
          type: 'string',
          name: 'knowledge_base_id',
          notNullable: true,
        }),
        expect.objectContaining({
          type: 'string',
          name: 'kb_snapshot_id',
          nullable: true,
        }),
        expect.objectContaining({
          type: 'string',
          name: 'skill_definition_id',
          notNullable: true,
        }),
        expect.objectContaining({
          type: 'string',
          name: 'connector_id',
          nullable: true,
        }),
        expect.objectContaining({
          type: 'jsonb',
          name: 'binding_config',
          nullable: true,
        }),
        expect.objectContaining({
          type: 'boolean',
          name: 'enabled',
          notNullable: true,
          defaultTo: true,
        }),
      ]),
    );
    expect(operations.timestamps).toEqual([
      { useTz: true, defaultToNow: true },
    ]);
    expect(operations.foreigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'knowledge_base_id',
          references: 'id',
          inTable: 'knowledge_base',
          onDelete: 'CASCADE',
        }),
        expect.objectContaining({
          name: 'kb_snapshot_id',
          references: 'id',
          inTable: 'kb_snapshot',
          onDelete: 'SET NULL',
        }),
        expect.objectContaining({
          name: 'skill_definition_id',
          references: 'id',
          inTable: 'skill_definition',
          onDelete: 'CASCADE',
        }),
        expect.objectContaining({
          name: 'connector_id',
          references: 'id',
          inTable: 'connector',
          onDelete: 'SET NULL',
        }),
      ]),
    );
    expect(operations.indexes).toEqual(
      expect.arrayContaining([['knowledge_base_id'], ['kb_snapshot_id']]),
    );
    expect(raw).toHaveBeenCalledWith(
      expect.stringContaining('COMMENT ON TABLE skill_binding'),
    );
  });
});
