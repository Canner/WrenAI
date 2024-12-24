import { readFileSync } from 'fs';
import { IMDLBuilder } from './mdlBuilder';
import { Manifest } from './type';
import { getConfig } from '@server/config';

const config = getConfig();

export class FileMDLBuilder implements IMDLBuilder {
  private filePath: string;

  constructor() {
    this.filePath = config.mdlFilePath;
  }

  public build(): Manifest {
    const fileContent = readFileSync(this.filePath, 'utf-8');
    const manifest: Manifest = JSON.parse(fileContent);
    return manifest;
  }
}
