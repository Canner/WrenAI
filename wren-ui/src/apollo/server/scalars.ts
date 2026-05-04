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
