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
});
