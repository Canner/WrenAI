import * as fs from 'fs';
import { getLogger } from '@server/utils';

const logger = getLogger('ConfigService');
logger.level = 'debug';

export interface Account {
  username: string;
  password: string;
}

export interface AccountsConfig {
  accounts: Account[];
}

export interface IConfigService {
  writeAccountsConfig(): void;
  getAccountsConfig(): AccountsConfig;
}

export class ConfigService implements IConfigService {
  private accounts: Account[] = [];
  private accountsConfigFilepath: string;

  constructor({
    accounts,
    accountsConfigFilepath,
  }: {
    accounts: Account[];
    accountsConfigFilepath: string;
  }) {
    this.accounts = accounts;
    this.accountsConfigFilepath = accountsConfigFilepath;
  }

  public initialize() {
    // write file
    // overwrite the accounts config file with the accounts
    this.writeAccountsConfig();
  }

  public writeAccountsConfig() {
    // write the accounts config to the file
    const accountsConfig: AccountsConfig = {
      accounts: this.accounts,
    };

    // make sure the directory exists
    const dir = this.accountsConfigFilepath.split('/').slice(0, -1).join('/');
    if (!fs.existsSync(dir)) {
      logger.debug(`Creating directory: ${dir}`);
      fs.mkdirSync(dir, { recursive: true });
    }

    // write the file
    logger.debug(`Writing accounts config to: ${this.accountsConfigFilepath}`);
    fs.writeFileSync(
      this.accountsConfigFilepath,
      this.formatAccountsConfigContent(accountsConfig),
    );
  }

  public getAccountsConfig() {
    // read the accounts config from the file
    const content = fs.readFileSync(this.accountsConfigFilepath, 'utf8');
    return this.parseAccountsConfigContent(content);
  }

  private formatAccountsConfigContent(accountsConfig: AccountsConfig): string {
    // the format of the accounts config content is
    // username: password per line
    return accountsConfig.accounts
      .map((account) => `${account.username}: ${account.password}`)
      .join('\n');
  }

  private parseAccountsConfigContent(content: string): AccountsConfig {
    // the format of the accounts config content is
    // username: password per line
    const accounts = content
      .split('\n')
      .map((line) => {
        const [username, password] = line.split(':');
        // remove leading and trailing spaces
        return { username: username.trim(), password: password.trim() };
      })
      // filter out empty username or password
      .filter((account) => account.username && account.password);
    return { accounts };
  }
}
