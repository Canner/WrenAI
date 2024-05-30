import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import * as modelingHelper from '../commonTests/modeling';

const suggestedQuestions = [
  'What are the top 3 value for orders placed by customers in each city?',
  'What is the average score of reviews submitted for orders placed by customers in each city?',
  'What is the total value of payments made by customers from each state?',
];

test.describe('Test E-commerce sample dataset', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Starting E-commerce dataset successfully', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'E-commerce' }).click();
    await expect(page).toHaveURL('/home', { timeout: 60000 });

    for (const question of suggestedQuestions) {
      await expect(page.getByText(question)).toBeVisible();
    }
  });

  test('Check should be in Synced status', modelingHelper.checkDeploySynced);

  test('Use suggestion question', async ({ page, baseURL }) => {
    // select first suggested question
    await homeHelper.askSuggestionQuestionTest({
      page,
      baseURL,
      suggestedQuestion: suggestedQuestions[1],
    });
  });

  test('Follow up question', async ({ page, baseURL }) => {
    await homeHelper.followUpQuestionTest({
      page,
      baseURL,
      question:
        'What are the total sales values for each quarter of each year?',
    });
  });

  test('Model CRUD successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    const modelDisplayName = 'customers';

    // click sidebar customers model
    await page.getByRole('complementary').getByText(modelDisplayName).click();

    // delete model
    await page
      .locator('div')
      .filter({ hasText: new RegExp(`^${modelDisplayName}$`) })
      .getByRole('button')
      .click();
    await page.getByText('Delete', { exact: true }).click();
    await expect(
      page
        .getByRole('dialog')
        .locator('div')
        .filter({ hasText: 'Are you sure you want to delete this model?' })
        .nth(1),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Successfully deleted model.')).toBeVisible();

    // check customers model is deleted
    await expect(
      page.getByRole('complementary').getByText(modelDisplayName),
    ).toBeHidden();

    // add model back
    await page
      .locator('div')
      .filter({ hasText: /^Models\(\d\)$/ })
      .locator('path')
      .first()
      .click();

    // chkeck Model drawer open
    await expect(page.locator('.ant-drawer-mask')).toBeVisible();
    await expect(
      page
        .locator('div')
        .filter({ hasText: /^Create a data model$/ })
        .first(),
    ).toBeVisible();

    // select customers table and some columns
    await page.getByLabel('Select a table').click();
    await page.getByTitle(modelDisplayName).locator('div').click();
    await page
      .getByRole('row', { name: /^Id .*/ })
      .getByLabel('')
      .check();

    await page.getByRole('button', { name: 'right' }).click();

    // set Id as primary key
    await page.getByLabel('Select primary key').click();
    await page.locator('form').getByTitle('Id').locator('div').click();
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(page.getByText('Successfully created model.')).toBeVisible();

    // check customers model is added
    await expect(
      page.getByRole('complementary').getByText(modelDisplayName),
    ).toBeVisible();
    await expect(
      page.getByTestId('diagram__model-node__customers'),
    ).toBeVisible();

    // update columns
    await page
      .locator('div')
      .filter({ hasText: new RegExp(`^${modelDisplayName}$`) })
      .getByRole('button')
      .click();
    await page.getByText('Update Columns').click();
    await page.getByLabel('', { exact: true }).first().check();
    await page.getByRole('button', { name: 'right' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(page.getByText('Successfully updated model.')).toBeVisible();
  });

  test('Add relationship successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    // Following the previous test, we assume the customers model is created, and it's have not any relationships
    const modelDisplayName = 'customers';
    const toFieldModelDisplayName = 'orders';

    // add relationship
    await page
      .locator('div')
      .filter({ hasText: /^Relationships$/ })
      .getByRole('button')
      .first()
      .click();

    // check relationship modal open
    await expect(
      page
        .locator('div')
        .filter({
          hasText: 'Add relationship',
        })
        .nth(2),
    ).toBeVisible();
    await expect(page.getByText('Add relationship')).toBeVisible();

    // from field
    await page.getByTestId('common__fields-select').first().click();
    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: 'Id' })
      .click();

    // to field
    await page.getByTestId('common__models-select').last().click();
    await page
      .getByTestId('common__models__select-option')
      .filter({ hasText: 'orders' })
      .click();
    await page.getByTestId('common__fields-select').last().click();
    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: 'CustomerId' })
      .click();

    // type
    await page.getByTestId('relationship-form__type-select').click();
    await page.getByText('One-to-many').click();
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(
      page.getByText('Successfully created relationship.'),
    ).toBeVisible();
    await expect(
      page
        .getByTestId(`diagram__model-node__${modelDisplayName}`)
        .getByTitle(toFieldModelDisplayName),
    ).toBeVisible();
  });

  test(
    'Check deploy is Undeployed changes',
    modelingHelper.checkDeployUndeployedChanges,
  );

  test('Relationship CRUD successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    const modelDisplayName = 'customers';
    const toFieldModelDisplayName = 'orders';

    await page.getByRole('complementary').getByText(modelDisplayName).click();

    // delete relationship
    await page
      .getByTestId(`diagram__model-node__${modelDisplayName}`)
      .getByRole('button', { name: 'more' })
      .nth(1)
      .click();
    await page.getByText('Delete', { exact: true }).click();

    // check delete relationship modal open
    await expect(
      page
        .getByRole('dialog')
        .locator('div')
        .filter({
          hasText: 'Are you sure you want to delete this relationship?',
        })
        .nth(1),
    ).toBeVisible();
    await expect(
      page.getByText('Are you sure you want to delete this relationship?'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(
      page.getByText('Successfully deleted relationship.'),
    ).toBeVisible();

    // check relationship is deleted
    await expect(
      page
        .getByTestId(`diagram__model-node__${modelDisplayName}`)
        .getByTitle(toFieldModelDisplayName),
    ).toBeHidden();

    // add relationship
    await page
      .locator('div')
      .filter({ hasText: /^Relationships$/ })
      .getByRole('button')
      .first()
      .click();

    // check relationship modal open
    await expect(
      page
        .locator('div')
        .filter({
          hasText: 'Add relationship',
        })
        .nth(2),
    ).toBeVisible();
    await expect(page.getByText('Add relationship')).toBeVisible();

    // from field
    await page.getByTestId('common__fields-select').first().click();
    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: 'Id' })
      .click();

    // to field
    await page.getByTestId('common__models-select').last().click();
    await page
      .getByTestId('common__models__select-option')
      .filter({ hasText: 'orders' })
      .click();
    await page.getByTestId('common__fields-select').last().click();
    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: 'CustomerId' })
      .click();

    // type
    await page.getByTestId('relationship-form__type-select').click();
    await page.getByText('One-to-one').click();
    await page.getByRole('button', { name: 'Submit' }).click();

    await expect(
      page.getByText('Successfully created relationship.'),
    ).toBeVisible();
    await expect(
      page
        .getByTestId(`diagram__model-node__${modelDisplayName}`)
        .getByTitle(toFieldModelDisplayName),
    ).toBeVisible();

    // update relationship
    await page.getByRole('complementary').getByText(modelDisplayName).click();
    await page
      .getByTestId(`diagram__model-node__${modelDisplayName}`)
      .getByRole('button', { name: 'more' })
      .nth(1)
      .click();

    await page.getByText('Edit').click();
    await expect(
      page
        .locator('div')
        .filter({
          hasText: 'Update relationship',
        })
        .nth(2),
    ).toBeVisible();
    await expect(page.getByText('Update relationship')).toBeVisible();

    await page.getByTestId('relationship-form__type-select').click();
    await page.getByTitle('One-to-many').locator('div').click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(
      page.getByText('Successfully updated relationship.'),
    ).toBeVisible();
  });
});
