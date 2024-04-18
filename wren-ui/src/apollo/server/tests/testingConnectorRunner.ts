import { TestingDatabase } from './testingDatabase';

export class TestingConnectorRunner {
  private testingDatabase: TestingDatabase;

  constructor(testingDatabase: TestingDatabase) {
    this.testingDatabase = testingDatabase;
  }

  public async testConnect(): Promise<void> {
    // Implementation goes here
  }

  public async testListTables(): Promise<void> {
    // Implementation goes here
  }

  public async testListConstraints(): Promise<void> {
    // Implementation goes here
  }
}
