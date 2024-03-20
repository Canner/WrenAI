import crypto from 'crypto';

export interface encryptOptions {
  password: string;
  salt: string;
  iteration?: number;
  keyLength?: number;
  algorithm?: string;
  separator?: string;
}

export class Encryptor {
  private readonly ENCRYPTION_PASSWORD: string;
  private readonly ENCRYPTION_SALT: string;
  private ENCRYPTION_ITERATION = 1000;
  private ENCRYPTION_KEY_LENGTH = 256 / 8; // in bytes
  private ENCRYPTION_ALGORITHM = 'aes-256-cbc';
  private ENCRYPTION_SEPARATOR = ':';

  constructor({
    encryptionPassword,
    encryptionSalt,
  }: {
    encryptionPassword: string;
    encryptionSalt: string;
  }) {
    this.ENCRYPTION_PASSWORD = encryptionPassword;
    this.ENCRYPTION_SALT = encryptionSalt;
  }

  public encrypt(credentials: JSON) {
    const credentialsString = JSON.stringify(credentials);
    const key = this.createSecretKey();
    const iv = crypto.randomBytes(16); // AES block size
    const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(credentialsString, 'utf8'),
      cipher.final(),
    ]);
    return (
      iv.toString('base64') +
      this.ENCRYPTION_SEPARATOR +
      encrypted.toString('base64')
    );
  }

  public decrypt(encryptedText: string) {
    const [ivBase64, encryptedBase64] = encryptedText.split(
      this.ENCRYPTION_SEPARATOR,
    );
    const iv = Buffer.from(ivBase64, 'base64');
    const encrypted = Buffer.from(encryptedBase64, 'base64');
    const key = this.createSecretKey();
    const decipher = crypto.createDecipheriv(
      this.ENCRYPTION_ALGORITHM,
      key,
      iv,
    );
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private createSecretKey() {
    return crypto.pbkdf2Sync(
      this.ENCRYPTION_PASSWORD,
      this.ENCRYPTION_SALT,
      this.ENCRYPTION_ITERATION,
      this.ENCRYPTION_KEY_LENGTH,
      'sha512',
    );
  }
}
