import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import * as modelingHelper from '../commonTests/modeling';
import { sampleDatasets } from '@/apollo/server/data';

const suggestedQuestions = sampleDatasets.ecommerce.questions;

test.describe('Test E-commerce sample dataset', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Starting E-commerce dataset successfully', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'E-commerce' }).click();
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });
  });

  test('Check suggested questions', async ({ page }) => {
    await page.goto('/home');
    for (const suggestedQuestion of suggestedQuestions) {
      await expect(page.getByText(suggestedQuestion.question)).toBeVisible();
    }
  });

  test(
    'Check deploy status should be in Synced status',
    modelingHelper.checkDeploySynced,
  );

  test('Use suggestion question', async ({ page }) => {
    // select first suggested question
    await homeHelper.askSuggestionQuestionTest({
      page,
      suggestedQuestion: suggestedQuestions[1].question,
    });
  });

  test('Follow up question', async ({ page }) => {
    await homeHelper.followUpQuestionTest({
      page,
      question: suggestedQuestions[2].question,
    });
  });

  test('Model CRUD successfully', async ({ page }) => {
    await modelingHelper.executeModelCRUD(page, {
      modelDisplayName: 'customers',
      modelReferenceName: 'olist_customers_dataset',
      primaryKeyColumn: 'customer_id',
    });
  });

  test('Update model metadata successfully', async ({ page }) => {
    await modelingHelper.updateModelMetadata(page, {
      modelDisplayName: 'olist_customers_dataset',
      modelDescription: '',
      newModelDisplayName: 'customers',
      newModelDescription: '',
    });
  });

  test('Add relationship successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    // Following the previous test, we assume the customers model is created, and it's have not any relationships
    await modelingHelper.addRelationship(page, {
      fromFieldModelDisplayName: 'customers',
      fromFieldColumnDisplayName: 'customer_id',
      toFieldModelDisplayName: 'orders',
      toFieldColumnDisplayName: 'customer_id',
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
      fromFieldColumnDisplayName: 'customer_id',
      toFieldModelDisplayName: 'orders',
      toFieldColumnDisplayName: 'customer_id',
      relationshipType: 'One-to-many',
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
    await homeHelper.saveAsView(
      { page, baseURL },
      {
        question:
          'What are the total sales values for each quarter of each year?',
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

    const modelDisplayName = 'orders';
    const calculatedFieldName = 'Sum of review scores';
    const expression = 'Sum';
    const toFieldModelDisplayName = 'order reviews';
    const toFieldColumnDisplayName = 'review_score';

    const newCfName = 'total product items';
    const newExpression = 'COUNT';
    const newToFieldModelDisplayName = 'order items';
    const newToFieldColumnDisplayName = 'order_id';

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
