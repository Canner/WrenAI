import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.goto('http://localhost:3000/setup/connection');
  await page.getByRole('button', { name: 'DuckDB DuckDB' }).click();
  await page.getByPlaceholder('DuckDB').click();
  await page.getByPlaceholder('DuckDB').fill('test');
  await page.getByPlaceholder('CREATE TABLE new_tbl AS').click();
  await page
    .getByPlaceholder('CREATE TABLE new_tbl AS')
    .fill('create table t1 ()');
  await page.getByPlaceholder('CREATE TABLE new_tbl AS').press('ArrowLeft');
  await page
    .getByPlaceholder('CREATE TABLE new_tbl AS')
    .fill('create table t1 (id integer, name string)');
  await page.getByPlaceholder('CREATE TABLE new_tbl AS').press('ArrowRight');
  await page
    .getByPlaceholder('CREATE TABLE new_tbl AS')
    .fill('create table t1 (id integer, name string);');
  await page.getByPlaceholder('Key').click();
  await page.getByPlaceholder('Key').fill('threads');
  await page.getByPlaceholder('Value').click();
  await page.getByPlaceholder('Value').fill('8');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.goto('http://localhost:3000/setup/models');
  await expect(page.locator('tbody')).toContainText('t1');
  await page
    .getByRole('row', { name: 't1', exact: true })
    .getByLabel('')
    .check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.goto('http://localhost:3000/setup/relationships');
  await expect(page.getByRole('cell', { name: 'No Data' })).toBeVisible();
  await page.getByRole('cell', { name: 'No Data' }).click();
});
