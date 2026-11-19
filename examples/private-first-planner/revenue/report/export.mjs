import { previewDocument } from '../../design/browser.mjs';
import { validateCode } from '../../design/contracts.mjs';
import { reportBootstrap } from './contract.mjs';

export function offlineReportDocument(spec, bundle, capabilities, viewport = { height: 900 }) {
  validateCode(spec, bundle);
  return previewDocument(spec, bundle.payload, viewport, { bootstrap: reportBootstrap(capabilities, bundle.payload), autoResize: true });
}
