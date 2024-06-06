import { test, expect } from '@playwright/test';
import * as helper from '../helper';
import * as homeHelper from '../commonTests/home';
import * as modelingHelper from '../commonTests/modeling';

const suggestedQuestions = [
  'How many three-pointers were made by each player in each game?',
  'What is the differences in turnover rates between teams with high and low average scores?',
  'Which teams had the highest average points scored per game throughout the season?',
];

test.describe('Test NBA sample dataset', () => {
  test.beforeAll(async () => {
    await helper.resetDatabase();
  });

  test('Starting NBA dataset successfully', async ({ page }) => {
    await page.goto('/setup/connection');
    await page.getByRole('button', { name: 'NBA' }).click();
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
      suggestedQuestion: suggestedQuestions[0],
    });
  });

  test('Follow up question', async ({ page, baseURL }) => {
    await homeHelper.followUpQuestionTest({
      page,
      baseURL,
      question: 'Which player has made the most three-pointers?',
    });
  });

  test('Model CRUD successfully', async ({ page }) => {
    await modelingHelper.executeModelCRUD(page, {
      modelDisplayName: 'player',
      primaryKeyColumn: 'Id',
    });
  });

  test('Add relationship successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    // Following the previous test, we assume the customers model is created, and it's have not any relationships
    await modelingHelper.addRelationship(page, {
      fromFieldModelDisplayName: 'player',
      fromFieldColumnDisplayName: 'TeamId',
      toFieldModelDisplayName: 'team',
      toFieldColumnDisplayName: 'Id',
      relationshipType: 'One-to-one',
    });
  });

  test(
    'Check deploy status should be in Undeployed changes status',
    modelingHelper.checkDeployUndeployedChanges,
  );

  test('Relationship CRUD successfully', async ({ page }) => {
    await modelingHelper.executeRelationshipCRUD(page, {
      fromFieldModelDisplayName: 'player',
      fromFieldColumnDisplayName: 'TeamId',
      toFieldModelDisplayName: 'team',
      toFieldColumnDisplayName: 'Id',
      relationshipType: 'One-to-one',
    });
  });

  test('Update model metadata successfully', async ({ page }) => {
    await modelingHelper.updateModelMetadata(page, {
      modelDisplayName: 'team',
      modelDescription:
        'This table describes NBA teams by their ID, team name, team abbreviation, and founding date.',
      newModelDisplayName: 'Team',
      newModelDescription:
        'The team data table describes NBA teams by their ID, team name, team abbreviation, and founding date.',
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
        question: suggestedQuestions[2],
        viewName: 'teams with highest average points per game',
      },
    );
  });

  test('Update view metadata successfully', async ({ page, baseURL }) => {
    await modelingHelper.updateViewMetadata(
      { page, baseURL },
      {
        viewDisplayName: 'teams with highest average points per game',
        viewDescription: '',
        newViewDisplayName: 'teams with the top average points per game',
        newViewDescription:
          'Describe the team with the highest average points scored per game',
      },
    );
  });

  test('Calculated Fields CRUD successfully', async ({ page }) => {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });

    const modelDisplayName = 'game';
    const cfName = 'count of games';
    const expression = 'Sum';
    const toFieldModelDisplayName = 'line_score';
    const toFieldColumnDisplayName = 'GameId';
    const newToFieldModelDisplayName = 'player_games';
    const newToFieldColumnDisplayName = 'GameID';

    await page
      .getByRole('complementary')
      .getByText(modelDisplayName, { exact: true })
      .click();

    // add calculated field
    await page
      .getByTestId(`diagram__model-node__${modelDisplayName}`)
      .locator('div')
      .filter({ hasText: /^Calculated Fields$/ })
      .getByRole('button')
      .first()
      .click();

    await expect(page.locator('.ant-modal-mask')).toBeVisible();
    await expect(page.locator('div.ant-modal')).toBeVisible();
    await expect(
      page
        .locator('div.ant-modal-title')
        .filter({ hasText: 'Add calculated field' }),
    ).toBeVisible();
    await expect(
      page
        .getByLabel('Add calculated field')
        .getByLabel('Close', { exact: true }),
    ).toBeVisible();

    await page.getByLabel('Name').click();
    await page.getByLabel('Name').fill(cfName);

    await page.getByTestId('common__descriptive-select').click();
    await page.getByTitle(expression).locator('div').click();

    await expect(page.getByTestId('common__lineage')).toBeVisible();

    await expect(
      page
        .getByTestId('common__lineage-field-block')
        .getByText(modelDisplayName, { exact: true }),
    ).toBeVisible();

    await page.getByTestId('common__lineage-fields-select').click();

    // for skip disabled item
    await page.getByTestId('common__lineage-fields-select').press('ArrowDown');
    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: toFieldModelDisplayName })
      .scrollIntoViewIfNeeded();
    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: toFieldModelDisplayName })
      .click();

    await expect(
      page
        .getByTestId('common__lineage-field-block')
        .getByText(toFieldModelDisplayName, { exact: true }),
    ).toHaveCount(2);

    await expect(page.getByText('Please select a field.')).toBeVisible();
    await page.getByTestId('common__lineage-fields-select').last().click();

    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: toFieldColumnDisplayName })
      .scrollIntoViewIfNeeded();

    await page
      .getByTestId('common__fields__select-option')
      .filter({ hasText: toFieldColumnDisplayName })
      .click();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Successfully created calculated field.'),
    ).toBeVisible();

    // update calculated field
    await page
      .getByTestId(`diagram__model-node__${modelDisplayName}`)
      .getByRole('button', { name: 'more' })
      .nth(1)
      .click();

    await page.getByText('Edit').click();

    await page
      .getByTestId('common__lineage-field-block')
      .filter({ hasText: toFieldModelDisplayName })
      .getByText(toFieldColumnDisplayName, { exact: true })
      .click();

    await page
      .getByTestId('common__lineage-fields-select')
      .last()
      .press('ArrowUp');
    await page
      .getByTestId('common__lineage-fields-select')
      .last()
      .press('ArrowUp');

    await page
      .getByTestId('common__fields__select-option')
      .getByText(newToFieldModelDisplayName, { exact: true })
      .scrollIntoViewIfNeeded();

    await page
      .getByTestId('common__fields__select-option')
      .getByText(newToFieldModelDisplayName, { exact: true })
      .click();
    await expect(
      page
        .getByTestId('common__lineage-field-block')
        .getByText(newToFieldModelDisplayName, { exact: true })
        .last(),
    ).toBeVisible();

    await page.getByTestId('common__lineage-fields-select').last().click();
    await page
      .getByTestId('common__lineage-fields-select')
      .last()
      .press('ArrowDown');

    await page
      .getByTestId('common__fields__select-option')
      .getByText(newToFieldColumnDisplayName, { exact: true })
      .scrollIntoViewIfNeeded();

    await page
      .getByTestId('common__fields__select-option')
      .getByText(newToFieldColumnDisplayName, { exact: true })
      .click();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Successfully updated calculated field.'),
    ).toBeVisible();

    // delete calculated field
    await page
      .getByRole('complementary')
      .getByText(modelDisplayName, { exact: true })
      .click();
    await page
      .getByTestId(`diagram__model-node__${modelDisplayName}`)
      .getByRole('button', { name: 'more' })
      .nth(1)
      .click();
    await page.getByText('Delete', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(
      page.getByText('Successfully deleted calculated field.'),
    ).toBeVisible();
  });
});
