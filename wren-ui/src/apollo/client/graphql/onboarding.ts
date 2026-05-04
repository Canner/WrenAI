import { gql } from '@apollo/client';

export const ONBOARDING_STATUS = gql`
  query OnboardingStatus {
    onboardingStatus {
      status
    }
  }
`;
