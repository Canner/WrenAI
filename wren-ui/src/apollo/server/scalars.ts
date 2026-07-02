import { GraphQLScalarType } from 'graphql';
import { DialectSQL } from '@server/models/adaptor';

export const DialectSQLScalar = new GraphQLScalarType({
  name: 'DialectSQL',
  description: 'A string representing a SQL query in a specific dialect',
  serialize(value: unknown): string {
    if (typeof value !== 'string') {
      throw new Error('DialectSQL must be a string');
    }
    return value;
  },
  parseValue(value: unknown): DialectSQL {
    if (typeof value !== 'string') {
      throw new Error('DialectSQL must be a string');
    }
    return value as DialectSQL;
  },
  parseLiteral(ast: any): DialectSQL {
    if (ast.kind !== 'StringValue') {
      throw new Error('DialectSQL must be a string');
    }
    return ast.value as DialectSQL;
  },
});

export const BigIntStringScalar = new GraphQLScalarType({
  name: 'BigIntString',
  description:
    'A bigint-compatible scalar serialized as a string to preserve precision across GraphQL and MSSQL.',
  serialize(value: unknown): string {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'bigint'
    ) {
      throw new Error('BigIntString must be a string, number, or bigint');
    }
    return String(value);
  },
  parseValue(value: unknown): string {
    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'bigint'
    ) {
      throw new Error('BigIntString must be a string, number, or bigint');
    }
    return String(value);
  },
  parseLiteral(ast: any): string {
    if (ast.kind !== 'StringValue' && ast.kind !== 'IntValue') {
      throw new Error('BigIntString must be a string or int literal');
    }
    return ast.value;
  },
});
