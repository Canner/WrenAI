import {
  OrganizationService,
  normalizeOrganizationIdentifier,
  validateOrganizationPayload,
} from '../organizationService';

describe('OrganizationService', () => {
  const mockOrganizationRepository = () => ({
    findAll: jest.fn(),
    findOneBy: jest.fn(),
    createOne: jest.fn(),
    updateOne: jest.fn(),
    transaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    getCurrentOrganization: jest.fn(),
    setCurrentOrganization: jest.fn(),
  });

  describe('validateOrganizationPayload', () => {
    it('should normalize valid payloads', () => {
      expect(
        validateOrganizationPayload({
          name: '  My Org  ',
          identifier: 'My Org',
          description: '  Team workspace  ',
        }),
      ).toEqual({
        name: 'My Org',
        identifier: 'my_org',
        description: 'Team workspace',
      });
    });

    it('should reject invalid identifiers', () => {
      expect(() =>
        validateOrganizationPayload({
          name: 'Org',
          identifier: '***',
        }),
      ).toThrow('Organization identifier is required');
    });
  });

  describe('createOrganization', () => {
    it('should make the first organization current', async () => {
      const repository = mockOrganizationRepository();
      const tx = {};
      repository.transaction.mockResolvedValue(tx);
      repository.getCurrentOrganization.mockResolvedValue(null);
      repository.findOneBy.mockResolvedValue(null);
      repository.createOne.mockResolvedValue({
        id: 1,
        name: 'My Org',
        identifier: 'my_org',
        description: '',
        isCurrent: true,
      });
      repository.setCurrentOrganization.mockResolvedValue({
        id: 1,
        name: 'My Org',
        identifier: 'my_org',
        description: '',
        isCurrent: true,
      });

      const service = new OrganizationService({
        organizationRepository: repository as any,
      });

      const result = await service.createOrganization({ name: 'My Org' });

      expect(repository.createOne).toHaveBeenCalledWith(
        {
          name: 'My Org',
          identifier: 'my_org',
          description: '',
          isCurrent: true,
        },
        { tx },
      );
      expect(repository.setCurrentOrganization).toHaveBeenCalledWith(1, { tx });
      expect(result.identifier).toBe('my_org');
    });

    it('should reject duplicate identifiers', async () => {
      const repository = mockOrganizationRepository();
      repository.findOneBy.mockResolvedValue({ id: 1, identifier: 'my_org' });
      const service = new OrganizationService({
        organizationRepository: repository as any,
      });

      await expect(
        service.createOrganization({ name: 'My Org', identifier: 'my_org' }),
      ).rejects.toThrow('Organization identifier already exists');
    });
  });

  describe('normalizeOrganizationIdentifier', () => {
    it('should collapse separators into underscores', () => {
      expect(normalizeOrganizationIdentifier('My cool-org!!')).toBe(
        'my_cool_org',
      );
    });
  });
});
