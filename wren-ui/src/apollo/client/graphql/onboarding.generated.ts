import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type OnboardingStatusQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type OnboardingStatusQuery = { __typename?: 'Query', onboardingStatus: { __typename?: 'OnboardingStatusResponse', status?: Types.OnboardingStatus | null } };


export const OnboardingStatusDocument = gql`
    query OnboardingStatus {
  onboardingStatus {
    status
  }
}
    `;

/**
 * __useOnboardingStatusQuery__
 *
 * To run a query within a React component, call `useOnboardingStatusQuery` and pass it any options that fit your needs.
 * When your component renders, `useOnboardingStatusQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useOnboardingStatusQuery({
 *   variables: {
 *   },
 * });
 */
export function useOnboardingStatusQuery(baseOptions?: Apollo.QueryHookOptions<OnboardingStatusQuery, OnboardingStatusQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<OnboardingStatusQuery, OnboardingStatusQueryVariables>(OnboardingStatusDocument, options);
      }
export function useOnboardingStatusLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<OnboardingStatusQuery, OnboardingStatusQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<OnboardingStatusQuery, OnboardingStatusQueryVariables>(OnboardingStatusDocument, options);
        }
export type OnboardingStatusQueryHookResult = ReturnType<typeof useOnboardingStatusQuery>;
export type OnboardingStatusLazyQueryHookResult = ReturnType<typeof useOnboardingStatusLazyQuery>;
export type OnboardingStatusQueryResult = Apollo.QueryResult<OnboardingStatusQuery, OnboardingStatusQueryVariables>;