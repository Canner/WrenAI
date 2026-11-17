import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateCode } from '../design/contracts.mjs';
import { isolatedBrowser, loadPreview } from '../design/browser.mjs';
import { requireThat } from '../contracts.mjs';
import { warningSummary } from './validation.mjs';

// Explicit local viewer. Generated JS runs only in the same network-denied,
// home-denied browser and opaque iframe used by QA, never in the host origin.
export async function previewCandidate(path, { headless = false } = {}) {
  const candidate = JSON.parse(await readFile(path, 'utf8'));
  requireThat(candidate.qa?.pass === true && candidate.result.state === 'generated');
  const { spec, bundle } = candidate.result; validateCode(spec, bundle);
  const browser = await isolatedBrowser({ headless });
  try {
    const view = await loadPreview(browser.browser, spec, bundle.payload, { width: 1280, height: 900 });
    return { view, assessment: candidate.qa, close: () => browser.close() };
  } catch (error) { await browser.close(); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await previewCandidate(process.argv[2]); let closing;
  const warning = warningSummary(preview.assessment); if (warning) console.log(warning);
  const close = () => closing ??= preview.close();
  const timer = setTimeout(close, 5 * 60_000);
  preview.view.page.on('close', () => { clearTimeout(timer); close(); });
  process.once('SIGINT', () => { clearTimeout(timer); close(); });
  process.once('SIGTERM', () => { clearTimeout(timer); close(); });
  console.log('Isolated preview ready. Close the window or press Ctrl+C. Maximum viewing time: five minutes.');
}
