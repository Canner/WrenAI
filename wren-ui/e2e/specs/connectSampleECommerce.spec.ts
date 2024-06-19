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

  test(
    'Check deploy status should be in Synced status',
    modelingHelper.checkDeploySynced,
  );

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
    await modelingHelper.executeModelCRUD(page, {
      modelDisplayName: 'customers',
      primaryKeyColumn: 'Id',
    });
  });

  test('Add relationship successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    // Following the previous test, we assume the customers model is created, and it's have not any relationships
    await modelingHelper.addRelationship(page, {
      fromFieldModelDisplayName: 'customers',
      fromFieldColumnDisplayName: 'Id',
      toFieldModelDisplayName: 'orders',
      toFieldColumnDisplayName: 'CustomerId',
      relationshipType: 'One-to-many',
    });
  });

  test(
    'Check deploy status should be in Undeployed changes status',
    modelingHelper.checkDeployUndeployedChanges,
  );

  test('Relationship CRUD successfully', async ({ page }) => {
    await modelingHelper.executeRelationshipCRUD(page, {
      fromFieldModelDisplayName: 'customers',
      fromFieldColumnDisplayName: 'Id',
      toFieldModelDisplayName: 'orders',
      toFieldColumnDisplayName: 'CustomerId',
      relationshipType: 'One-to-many',
    });
  });

  test('Update model metadata successfully', async ({ page }) => {
    await modelingHelper.updateModelMetadata(page, {
      modelDisplayName: 'orders',
      modelDescription: 'A model representing the orders data.',
      newModelDisplayName: 'Orders',
      newModelDescription: '',
    });
  });

  test('Trigger and check deploy MDL successfully', async ({
    page,
    baseURL,
  }) => {
    await modelingHelper.executeDeploy({ page, baseURL });
    await modelingHelper.checkDeploySynced({ page });
  });

  test('Save as view successfully', async ({ page, baseURL }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    await homeHelper.saveAsView(
      { page, baseURL },
      {
        question: suggestedQuestions[1],
        viewName: 'avg review score by city',
      },
    );
  });

  test('Update view metadata successfully', async ({ page, baseURL }) => {
    await modelingHelper.updateViewMetadata(
      { page, baseURL },
      {
        viewDisplayName: 'avg review score by city',
        viewDescription: '',
        newViewDisplayName: 'avg review score per city',
        newViewDescription:
          'Average review score for orders placed by customers in each city.',
      },
    );
  });

  test('Calculated Fields CRUD successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    const modelDisplayName = 'Orders';
    const calculatedFieldName = 'Sum of review scores';
    const expression = 'Sum';
    const toFieldModelDisplayName = 'reviews';
    const toFieldColumnDisplayName = 'Score';

    const newCfName = 'total product items';
    const newExpression = 'COUNT';
    const newToFieldModelDisplayName = 'order_items';
    const newToFieldColumnDisplayName = 'OrderId';

    await modelingHelper.addCalculatedField(page, {
      calculatedFieldName,
      expression,
      modelDisplayName,
      toFieldModelDisplayName,
      toFieldColumnDisplayName,
    });

    // update calculated field
    await page
      .getByTestId(`diagram__model-node__${modelDisplayName}`)
      .getByRole('button', { name: 'more' })
      .nth(1)
      .click();

    await page.getByText('Edit').click();

    await page.getByLabel('Name').click();
    await page.getByLabel('Name').fill(newCfName);

    await page.getByTestId('common__descriptive-select').click();
    await page.getByTitle(newExpression).locator('div').click();

    await page
      .getByTestId('common__lineage-field-block')
      .filter({ hasText: modelDisplayName })
      .getByText(toFieldModelDisplayName, { exact: true })
      .click();

    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: newToFieldModelDisplayName })
      .scrollIntoViewIfNeeded();

    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: newToFieldModelDisplayName })
      .click();

    await expect(
      page
        .getByTestId('common__lineage-field-block')
        .getByText(newToFieldModelDisplayName, { exact: true }),
    ).toHaveCount(2);
    await expect(page.getByText('Please select a field.')).toBeVisible();
    await page.getByTestId('common__lineage-fields-select').last().click();

    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: newToFieldColumnDisplayName })
      .scrollIntoViewIfNeeded();

    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: newToFieldColumnDisplayName })
      .click();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Successfully updated calculated field.'),
    ).toBeVisible();

    // delete calculated field
    await modelingHelper.deleteCalculatedField(page, modelDisplayName);
  });
});
