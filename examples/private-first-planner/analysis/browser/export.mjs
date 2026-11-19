import { previewDocument } from '../../design/browser.mjs';
import { validateCode } from '../../design/contracts.mjs';
import { aggregateBootstrap, validateReport } from './contract.mjs';
import { digest, requireThat } from '../../contracts.mjs';
export function aggregateReportDocument(spec, bundle, report) {
  validateCode(spec, bundle); validateReport(report); requireThat(digest(bundle.payload) === report.capabilities.data_version);
  return previewDocument(spec, bundle.payload, { height: 900 }, { bootstrap: aggregateBootstrap(report), autoResize: true });
}
