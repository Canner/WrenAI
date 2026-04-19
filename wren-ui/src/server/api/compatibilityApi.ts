import type { NextApiResponse } from 'next';

type CompatibilityApiHeadersOptions = {
  successorRoute?: string;
  warning?: string;
};

const buildSuccessorVersionLink = (successorRoute: string) =>
  `<${successorRoute}>; rel="successor-version"`;

export const buildCompatibilityWarningHeader = (message: string) =>
  `299 - "${message}"`;

export const applyCompatibilityApiHeaders = (
  res: NextApiResponse,
  options: CompatibilityApiHeadersOptions = {},
) => {
  res.setHeader('Deprecation', 'true');

  if (options.successorRoute) {
    res.setHeader('Link', buildSuccessorVersionLink(options.successorRoute));
  }

  if (options.warning) {
    res.setHeader('Warning', buildCompatibilityWarningHeader(options.warning));
  }
};
