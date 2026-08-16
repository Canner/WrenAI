import { expect, test } from '@playwright/test';

test('Setup Work log exposes bounded inspection details without raw trace fields', async ({ page }) => {
  await page.goto('/e2e/setup-worklog.html');

  const done = page.getByRole('button', { name: /Build context \(done\).*Toggle step details/ });
  const running = page.getByRole('button', { name: /Discover schema \(running\).*Toggle step details/ });
  const error = page.getByRole('button', { name: /Validate context \(error\).*Toggle step details/ });
  const longOutput = page.getByRole('button', { name: /Generate model \(done\).*Toggle step details/ });

  await expect(done).toHaveAttribute('aria-expanded', 'false');
  await expect(running).toHaveAttribute('aria-expanded', 'false');
  await expect(error).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Prepare workspace')).toBeVisible();
  await expect(page.getByRole('button', { name: /Prepare workspace/ })).toHaveCount(0);

  await done.focus();
  await page.keyboard.press('Enter');
  await expect(done).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('wren context build')).toBeVisible();
  await expect(page.getByText('Built 3 models.')).toBeVisible();
  await expect(page.getByText('1.3 s')).toBeVisible();

  await error.click();
  await expect(error).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Connection refused. Check the database host and retry.')).toBeVisible();
  await expect(page.getByText('Built 3 models.')).toBeVisible();

  await longOutput.click();
  await expect(page.getByText(/Bounded output\. Bounded output\./)).toBeVisible();
});
