import { Page, expect } from '@playwright/test';
interface Relationship {
  fromFieldModelDisplayName: string;
  fromFieldColumnDisplayName: string;
  toFieldModelDisplayName: string;
  toFieldColumnDisplayName: string;
  relationshipType: string;
}

export const checkDeploySynced = async ({ page }) => {
  await page.goto('/modeling');
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  await expect(page.getByLabel('check-circle').locator('svg')).toBeVisible();
  await expect(page.getByText('Synced')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeDisabled();
};

export const checkDeployUndeployedChanges = async ({ page, baseURL }) => {
  if (page.url() !== `${baseURL}/modeling`) {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });
  }

  await expect(page.getByLabel('warning').locator('svg')).toBeVisible();
  await expect(page.getByText('Undeployed changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deploy' })).toBeEnabled();
};

export const executeDeploy = async ({ page, baseURL }) => {
  if (page.url() !== `${baseURL}/modeling`) {
    await page.goto('/modeling');
    await expect(page).toHaveURL('/modeling', { timeout: 60000 });
  }

  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(
    page.getByRole('img', { name: 'loading' }).locator('svg'),
  ).toBeVisible();
  await expect(page.getByText('Deploying...')).toBeVisible();
  await expect(page.getByText('Deploying...')).toBeVisible({
    visible: false,
    timeout: 60000,
  });
};

export const executeModelCRUD = async (
  page: Page,
  {
    modelDisplayName,
    modelReferenceName,
    primaryKeyColumn,
  }: {
    modelDisplayName: string;
    modelReferenceName: string;
    primaryKeyColumn: string;
  },
) => {
  await page.goto('/modeling');
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  // click the model of sidebar
  await page
    .getByRole('complementary')
    .getByText(modelDisplayName, { exact: true })
    .click();

  // delete the model
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

  // check model deleted
  await expect(page.getByText('Successfully deleted model.')).toBeVisible();
  await expect(
    page
      .getByRole('complementary')
      .getByText(modelDisplayName, { exact: true }),
  ).toBeHidden();

  // add the model back
  await page.getByTestId('add-model').click();

  // chkeck Model drawer open
  await expect(page.locator('.ant-drawer-mask')).toBeVisible();
  await expect(
    page
      .locator('div')
      .filter({ hasText: /^Create a data model$/ })
      .first(),
  ).toBeVisible();

  // select resource table and some columns
  await page.getByLabel('Select a table').click();
  await page
    .getByTitle(modelReferenceName, { exact: true })
    .locator('div')
    .click();

  await page
    .getByRole('row', { name: new RegExp(`^${primaryKeyColumn} .*`) })
    .getByLabel('')
    .check();

  await page.getByRole('button', { name: 'right' }).click();

  // set primary key
  await page.getByLabel('Select primary key').click();
  await page
    .locator('form')
    .getByTitle(primaryKeyColumn, { exact: true })
    .locator('div')
    .click();

  await page.getByRole('button', { name: 'Submit' }).click();

  // check model added
  await expect(page.getByText('Successfully created model.')).toBeVisible();
  await expect(
    page
      .getByRole('complementary')
      .getByText(modelReferenceName, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId(`diagram__model-node__${modelReferenceName}`),
  ).toBeVisible();

  // update columns
  await page
    .locator('div')
    .filter({ hasText: new RegExp(`^${modelReferenceName}$`) })
    .getByRole('button')
    .click();
  await page.getByText('Update Columns').click();

  // select all columns
  await page.getByLabel('', { exact: true }).first().check();
  await page.getByRole('button', { name: 'right' }).click();

  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByText('Successfully updated model.')).toBeVisible();
};

export const addRelationship = async (
  page: Page,
  {
    fromFieldModelDisplayName,
    fromFieldColumnDisplayName,
    toFieldModelDisplayName,
    toFieldColumnDisplayName,
    relationshipType,
  }: Relationship,
) => {
  // add relationship
  await page
    .getByTestId(`diagram__model-node__${fromFieldModelDisplayName}`)
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

  // set from field
  await page.getByTestId('common__fields-select').first().click();
  await page
    .getByTestId('common__fields__select-option')
    .filter({ hasText: fromFieldColumnDisplayName })
    .click();

  // set to field
  await page.getByTestId('common__models-select').last().click();
  await page
    .getByTestId('common__models__select-option')
    .filter({ hasText: toFieldModelDisplayName })
    .click();
  await page.getByTestId('common__fields-select').last().click();
  await page
    .getByTestId('common__fields__select-option')
    .filter({ hasText: toFieldColumnDisplayName })
    .last()
    .click();

  // set relationship type
  await page.getByTestId('relationship-form__type-select').click();
  await page.getByTitle(relationshipType).locator('div').click();

  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(
    page.getByText('Successfully created relationship.'),
  ).toBeVisible();
  await expect(
    page
      .getByTestId(`diagram__model-node__${fromFieldModelDisplayName}`)
      .getByTitle(toFieldModelDisplayName, { exact: true }),
  ).toBeVisible();
};

export const executeRelationshipCRUD = async (
  page: Page,
  {
    fromFieldModelDisplayName,
    fromFieldColumnDisplayName,
    toFieldModelDisplayName,
    toFieldColumnDisplayName,
    relationshipType,
  }: Relationship,
) => {
  await page.goto('/modeling');
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  await page
    .getByRole('complementary')
    .getByText(fromFieldModelDisplayName, { exact: true })
    .click();

  // delete relationship
  await page
    .getByTestId(`diagram__model-node__${fromFieldModelDisplayName}`)
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

  // check relationship deleted
  await expect(
    page.getByText('Successfully deleted relationship.'),
  ).toBeVisible();
  await expect(
    page
      .getByTestId(`diagram__model-node__${fromFieldModelDisplayName}`)
      .getByTitle(toFieldModelDisplayName, { exact: true }),
  ).toBeHidden();

  // add relationship
  await addRelationship(page, {
    fromFieldModelDisplayName,
    fromFieldColumnDisplayName,
    toFieldModelDisplayName,
    toFieldColumnDisplayName,
    relationshipType: 'One-to-one',
  });

  // update relationship
  await page
    .getByRole('complementary')
    .getByText(fromFieldModelDisplayName, { exact: true })
    .click();
  await page
    .getByTestId(`diagram__model-node__${fromFieldModelDisplayName}`)
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
  await page.getByTitle(relationshipType).locator('div').click();

  await page.getByRole('button', { name: 'Submit' }).click();

  // check relationship updated
  await expect(
    page.getByText('Successfully updated relationship.'),
  ).toBeVisible();
};

export const updateModelMetadata = async (
  page: Page,
  {
    modelDisplayName,
    modelDescription,
    newModelDisplayName,
    newModelDescription,
  }: {
    modelDisplayName: string;
    modelDescription: string;
    newModelDisplayName: string;
    newModelDescription: string;
  },
) => {
  await page.goto('/modeling');
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  await page
    .getByRole('complementary')
    .getByText(modelDisplayName, { exact: true })
    .click();

  // click node to open metadata drawer
  await page.getByTestId(`diagram__model-node__${modelDisplayName}`).click();

  const modelDescriptionString = modelDescription || '-';
  const newModelDescriptionString = newModelDescription || '-';

  // check metadata drawer info
  await expect(page.locator('.ant-drawer-mask')).toBeVisible();
  await expect(page.getByLabel('Close', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('div.ant-drawer-title')
      .filter({ hasText: new RegExp(`^${modelDisplayName}$`) }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Name' }).locator('div'),
  ).toHaveText(modelDisplayName);
  await expect(page.getByTestId('metadata__alias').locator('div')).toHaveText(
    modelDisplayName,
  );
  await expect(
    page.getByTestId('metadata__description').locator('div'),
  ).toHaveText(modelDescriptionString);

  // click edit metadata button
  await page.getByRole('button', { name: 'Edit' }).click();

  // check edit metadata modal
  await expect(page.locator('.ant-modal-mask')).toBeVisible();
  await expect(page.locator('div.ant-modal')).toBeVisible();
  await expect(
    page.locator('div.ant-modal-title').filter({ hasText: 'Edit metadata' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Edit metadata').getByLabel('Close', { exact: true }),
  ).toBeVisible();

  // update metadata process
  // update alias
  await page
    .getByTestId('edit-metadata__alias')
    .getByText(modelDisplayName, { exact: true })
    .click();
  await page.locator('#displayName').press('ControlOrMeta+a');
  await page.locator('#displayName').fill(newModelDisplayName);

  // update description
  await page
    .getByTestId('edit-metadata__description')
    .getByText(modelDescriptionString, { exact: true })
    .click();
  await page.locator('#description').press('ControlOrMeta+a');
  await page.locator('#description').fill(newModelDescription);

  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();

  // check metadata for metadata drawer
  await expect(
    page.getByText('Successfully updated model metadata.'),
  ).toBeVisible();
  await expect(
    page
      .locator('div.ant-drawer-title')
      .filter({ hasText: new RegExp(`^${newModelDisplayName}$`) }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Name' }).locator('div').first(),
  ).toHaveText(modelDisplayName);
  await expect(
    page.getByTestId('metadata__name').locator('div').first(),
  ).toHaveText(modelDisplayName);
  await expect(page.getByTestId('metadata__alias').locator('div')).toHaveText(
    newModelDisplayName,
  );
  await expect(
    page.getByTestId('metadata__description').locator('div'),
  ).toHaveText(newModelDescriptionString);

  // close metadata drawer
  await page
    .locator('div.ant-drawer')
    .getByLabel('Close', { exact: true })
    .click();

  // check info for modeling page
  await expect(
    page.getByRole('complementary').getByText(newModelDisplayName),
  ).toBeVisible();
  await page.getByRole('complementary').getByText(newModelDisplayName).click();
  await expect(
    page.getByTestId(`diagram__model-node__${newModelDisplayName}`),
  ).toBeVisible();
};

export const updateViewMetadata = async (
  { page, baseURL }: { page: Page; baseURL: string },
  {
    viewDisplayName,
    viewDescription,
    newViewDisplayName,
    newViewDescription,
  }: {
    viewDisplayName: string;
    viewDescription: string;
    newViewDisplayName: string;
    newViewDescription: string;
  },
) => {
  await page.goto('/modeling');
  await expect(page).toHaveURL('/modeling', { timeout: 60000 });

  // will show '-' if viewDescription is empty string
  const viewDescriptionString = viewDescription || '-';
  const newViewDescriptionString = newViewDescription || '-';

  await page
    .getByRole('complementary')
    .getByText(viewDisplayName, { exact: true })
    .click();

  // click node to open metadata drawer
  await page.getByTestId(`diagram__view-node__${viewDisplayName}`).click();

  // check metadata drawer info
  await expect(page.locator('.ant-drawer-mask')).toBeVisible();
  await expect(page.getByLabel('Close', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('div.ant-drawer-title')
      .filter({ hasText: new RegExp(`^${viewDisplayName}$`) }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

  await expect(
    page.getByTestId('metadata__name').getByText(viewDisplayName),
  ).toBeVisible();
  await expect(
    page.getByTestId('metadata__description').getByText(viewDescriptionString),
  ).toBeVisible();

  // click edit metadata button
  await page.getByRole('button', { name: 'Edit' }).click();

  // check edit metadata modal
  await expect(page.locator('.ant-modal-mask')).toBeVisible();
  await expect(page.locator('div.ant-modal')).toBeVisible();
  await expect(
    page.locator('div.ant-modal-title').filter({ hasText: 'Edit metadata' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Edit metadata').getByLabel('Close', { exact: true }),
  ).toBeVisible();

  // update metadata process
  // update name (view alias name)
  await page
    .getByTestId('edit-metadata__name')
    .getByText(viewDisplayName, { exact: true })
    .click();
  await page.locator('#displayName').fill(newViewDisplayName);

  // update description
  await page
    .getByTestId('edit-metadata__description')
    .getByText(viewDescriptionString, { exact: true })
    .click();
  await page.locator('#description').fill(newViewDescription);

  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();

  // check metadata for metadata drawer
  await expect(
    page.getByText('Successfully updated view metadata.'),
  ).toBeVisible();
  await expect(
    page
      .locator('div.ant-drawer-title')
      .filter({ hasText: new RegExp(`^${newViewDisplayName}$`) }),
  ).toBeVisible();

  await expect(page.getByTestId('metadata__name').locator('div')).toHaveText(
    newViewDisplayName,
  );
  await expect(
    page.getByTestId('metadata__description').locator('div'),
  ).toHaveText(newViewDescriptionString);

  // close metadata drawer
  await page
    .locator('div.ant-drawer')
    .getByLabel('Close', { exact: true })
    .click();

  // check info for modeling page
  await expect(
    page.getByRole('complementary').getByText(newViewDisplayName),
  ).toBeVisible();
  await page.getByRole('complementary').getByText(newViewDisplayName).click();
  await expect(
    page.getByTestId(`diagram__view-node__${newViewDisplayName}`),
  ).toBeVisible();

  await checkDeployUndeployedChanges({ page, baseURL });
};

export const addCalculatedField = async (
  page: Page,
  {
    calculatedFieldName,
    expression,
    modelDisplayName,
    toFieldModelDisplayName,
    toFieldColumnDisplayName,
  }: {
    calculatedFieldName: string;
    expression: string;
    modelDisplayName: string;
    toFieldModelDisplayName: string;
    toFieldColumnDisplayName: string;
  },
) => {
  // click the model of sidebar to zoom in
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
  await page.getByLabel('Name').fill(calculatedFieldName);

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
};

export const deleteCalculatedField = async (
  page: Page,
  modelDisplayName: string,
) => {
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
};
