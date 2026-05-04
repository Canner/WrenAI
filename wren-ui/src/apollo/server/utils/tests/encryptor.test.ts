import { Encryptor } from '../encryptor';
import crypto from 'crypto';

jest.mock('crypto', () => ({
  randomBytes: jest.fn(),
  createCipheriv: jest.fn(),
  createDecipheriv: jest.fn(),
  pbkdf2Sync: jest.fn(),
}));

const credentials = { username: 'user', password: 'pass' };

describe('Encryptor', () => {
  const mockConfig = {
    encryptionPassword: 'testPassword',
    encryptionSalt: 'testSalt',
  };

  let encryptor: Encryptor;
  beforeEach(() => {
    encryptor = new Encryptor(mockConfig);
  });

  it('should encrypt data correctly', async () => {
    // Arrange
    const testData = JSON.parse(JSON.stringify(credentials));
    const mockIV = Buffer.from('mockIV');
    (crypto.randomBytes as jest.Mock).mockReturnValue(mockIV);
    const mockCipher = {
      update: jest.fn().mockReturnValue(Buffer.from('ciphered')),
      final: jest.fn().mockReturnValue(Buffer.from('finalCiphered')),
    };
    (crypto.createCipheriv as jest.Mock).mockReturnValue(mockCipher);

    // Act
    const encryptedData = await encryptor.encrypt(testData);

    // Assert
    expect(encryptedData).toContain(Buffer.from('mockIV').toString('base64')); // Basic check, more sophisticated assertions can be made
    expect(encryptedData).toContain(':'); // contain seperator
    expect(encryptedData).toContain(
      Buffer.concat([
        Buffer.from('ciphered'),
        Buffer.from('finalCiphered'),
      ]).toString('base64'),
    ); // contain ciphered data
    expect(crypto.createCipheriv).toHaveBeenCalled();
  });

  it('should decrypt data correctly', async () => {
    // Setup
    const encryptedData = 'mockIV:encryptedData';
    const mockDecrypted = Buffer.from(JSON.stringify(credentials));
    const mockDecipher = {
      update: jest.fn().mockReturnValue(mockDecrypted),
      final: jest.fn().mockReturnValue(Buffer.from('')),
    };
    (crypto.createDecipheriv as jest.Mock).mockReturnValue(mockDecipher);

    // Act
    const decryptedData = await encryptor.decrypt(encryptedData);

    // Assert
    expect(decryptedData).toEqual(JSON.stringify(credentials));
    expect(crypto.createDecipheriv).toHaveBeenCalled();
  });

  it('should return original data after encrypt and decrypt', async () => {
    // Setup
    const testData = JSON.parse('{"username":"user","password":"pass"}');
    const mockIV = Buffer.from('mockIV');
    (crypto.randomBytes as jest.Mock).mockReturnValue(mockIV);
    const mockCipher = {
      update: jest.fn().mockReturnValue(Buffer.from('ciphered')),
      final: jest.fn().mockReturnValue(Buffer.from('finalCiphered')),
    };
    (crypto.createCipheriv as jest.Mock).mockReturnValue(mockCipher);

    const mockDecipher = {
      update: jest.fn().mockReturnValue(Buffer.from(JSON.stringify(testData))),
      final: jest.fn().mockReturnValue(Buffer.from('')),
    };
    (crypto.createDecipheriv as jest.Mock).mockReturnValue(mockDecipher);

    // Act
    const encryptedData = await encryptor.encrypt(testData);
    const decryptedData = await encryptor.decrypt(encryptedData);

    // Assert
    expect(JSON.parse(decryptedData)).toEqual(testData);
  });
});
