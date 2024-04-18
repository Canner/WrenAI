export interface TestingContext {
  tpch: {
    // /path/to/tpch/data
    dataDir?: string;
  };
}

export interface TestingDatabase<C = any> {
  initialize(context: TestingContext): Promise<void>;
  getContainer(): C;
}
