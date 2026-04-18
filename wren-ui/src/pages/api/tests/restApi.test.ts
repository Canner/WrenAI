import { ApiError } from '@/server/utils/apiUtils';
import { inferRestApiStatusCode, sendRestApiError } from '../v1/restApi';

describe('pages/api/v1/restApi', () => {
  it('keeps explicit ApiError status codes', () => {
    expect(inferRestApiStatusCode(new ApiError('bad request', 422))).toBe(422);
  });

  it('maps request validation messages to 400 without relying on generic failed text', () => {
    expect(
      inferRestApiStatusCode(new Error('knowledge base id is required')),
    ).toBe(400);
    expect(
      inferRestApiStatusCode(new Error('Connector config must be an object')),
    ).toBe(400);
    expect(inferRestApiStatusCode(new Error('Query failed unexpectedly'))).toBe(
      500,
    );
  });

  it('does not downgrade internal TypeError-style messages into 400', () => {
    expect(
      inferRestApiStatusCode(new Error('Cannot read properties of undefined')),
    ).toBe(500);
  });

  it('serializes the inferred status code and message to the response', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status } as any;

    sendRestApiError(res, new Error('Method not allowed'), 'fallback');

    expect(status).toHaveBeenCalledWith(405);
    expect(json).toHaveBeenCalledWith({ error: 'Method not allowed' });
  });
});
