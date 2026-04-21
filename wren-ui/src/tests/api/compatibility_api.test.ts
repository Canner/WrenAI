import {
  applyCompatibilityApiHeaders,
  buildCompatibilityWarningHeader,
} from '@/server/api/compatibilityApi';

describe('server/api/compatibilityApi', () => {
  const createResponse = () =>
    ({
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
    }) as any;

  it('always marks compatibility endpoints as deprecated', () => {
    const res = createResponse();

    applyCompatibilityApiHeaders(res);

    expect(res.headers.Deprecation).toBe('true');
  });

  it('adds successor-version link headers when a canonical route is provided', () => {
    const res = createResponse();

    applyCompatibilityApiHeaders(res, {
      successorRoute: '/api/v1/asking-tasks/[id]/stream',
    });

    expect(res.headers.Link).toBe(
      '</api/v1/asking-tasks/[id]/stream>; rel="successor-version"',
    );
  });

  it('formats RFC 7234 warning headers for deprecated API messaging', () => {
    expect(
      buildCompatibilityWarningHeader(
        'Deprecated API: use the ask/chart workflow instead.',
      ),
    ).toBe('299 - "Deprecated API: use the ask/chart workflow instead."');

    const res = createResponse();
    applyCompatibilityApiHeaders(res, {
      warning: 'Deprecated API: use the ask/chart workflow instead.',
    });

    expect(res.headers.Warning).toBe(
      '299 - "Deprecated API: use the ask/chart workflow instead."',
    );
  });
});
