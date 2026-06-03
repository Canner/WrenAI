import { ApiError } from '../utils/apiUtils';
import {
  IOrganizationRepository,
  Organization,
} from '../repositories/organizationRepository';

export interface CreateOrganizationData {
  name: string;
  identifier?: string;
  description?: string;
}

export interface IOrganizationService {
  listOrganizations: () => Promise<Organization[]>;
  getCurrentOrganization: () => Promise<Organization | null>;
  createOrganization: (data: CreateOrganizationData) => Promise<Organization>;
  selectCurrentOrganization: (id: number) => Promise<Organization>;
}

const NAME_MAX_LENGTH = 64;
const IDENTIFIER_MAX_LENGTH = 64;
const DESCRIPTION_MAX_LENGTH = 255;
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

export const normalizeOrganizationName = (value: string) => value.trim();

export const normalizeOrganizationIdentifier = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

export const validateOrganizationPayload = (
  data: CreateOrganizationData,
): Required<CreateOrganizationData> => {
  const name = normalizeOrganizationName(data.name || '');
  const identifier = normalizeOrganizationIdentifier(
    data.identifier || data.name || '',
  );
  const description = (data.description || '').trim();

  if (!name) {
    throw new ApiError('Organization name is required', 400);
  }
  if (name.length > NAME_MAX_LENGTH) {
    throw new ApiError(
      `Organization name is too long (max ${NAME_MAX_LENGTH} characters)`,
      400,
    );
  }
  if (!identifier) {
    throw new ApiError('Organization identifier is required', 400);
  }
  if (identifier.length > IDENTIFIER_MAX_LENGTH) {
    throw new ApiError(
      `Organization identifier is too long (max ${IDENTIFIER_MAX_LENGTH} characters)`,
      400,
    );
  }
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new ApiError(
      'Organization identifier must contain only lowercase letters, numbers, underscores, or hyphens',
      400,
    );
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    throw new ApiError(
      `Organization description is too long (max ${DESCRIPTION_MAX_LENGTH} characters)`,
      400,
    );
  }

  return {
    name,
    identifier,
    description,
  };
};

export class OrganizationService implements IOrganizationService {
  private organizationRepository: IOrganizationRepository;

  constructor({
    organizationRepository,
  }: {
    organizationRepository: IOrganizationRepository;
  }) {
    this.organizationRepository = organizationRepository;
  }

  public async listOrganizations() {
    return await this.organizationRepository.findAll({ order: 'id' });
  }

  public async getCurrentOrganization() {
    return await this.organizationRepository.getCurrentOrganization();
  }

  public async createOrganization(data: CreateOrganizationData) {
    const payload = validateOrganizationPayload(data);
    const existingByIdentifier = await this.organizationRepository.findOneBy({
      identifier: payload.identifier,
    });
    if (existingByIdentifier) {
      throw new ApiError('Organization identifier already exists', 409);
    }

    const tx = await this.organizationRepository.transaction();
    try {
      const currentOrganization =
        await this.organizationRepository.getCurrentOrganization({ tx });
      const created = await this.organizationRepository.createOne(
        {
          ...payload,
          isCurrent: !currentOrganization,
        },
        { tx },
      );
      const result = currentOrganization
        ? created
        : await this.organizationRepository.setCurrentOrganization(created.id, {
            tx,
          });
      await this.organizationRepository.commit(tx);
      return result;
    } catch (error) {
      await this.organizationRepository.rollback(tx);
      throw error;
    }
  }

  public async selectCurrentOrganization(id: number) {
    const organization = await this.organizationRepository.findOneBy({ id });
    if (!organization) {
      throw new ApiError('Organization not found', 404);
    }

    return await this.organizationRepository.setCurrentOrganization(id);
  }
}
