/* Fingerprints (CRM entities) */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { UseQueryOptions, UseMutationOptions, QueryObserverResult } from '@tanstack/react-query';
import type {
  TFingerprint,
  TCreateFingerprint,
  TUpdateFingerprint,
  TFingerprintsResponse,
  TFingerprintSearchParams,
  TFingerprintSearchResponse,
  TFingerprintExtractParams,
  TFingerprintExtractResponse,
} from 'librechat-data-provider';

export const useGetFingerprintsQuery = (
  config?: UseQueryOptions<TFingerprintsResponse>,
): QueryObserverResult<TFingerprintsResponse> => {
  return useQuery<TFingerprintsResponse>(
    [QueryKeys.fingerprints],
    () => dataService.getFingerprints(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useCreateFingerprintMutation = (
  options?: UseMutationOptions<TFingerprint, Error, TCreateFingerprint>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TFingerprint, Error, TCreateFingerprint>(
    (data) => dataService.createFingerprint(data),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.fingerprints]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export type UpdateFingerprintParams = { id: string; data: TUpdateFingerprint };
export const useUpdateFingerprintMutation = (
  options?: UseMutationOptions<TFingerprint, Error, UpdateFingerprintParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TFingerprint, Error, UpdateFingerprintParams>(
    ({ id, data }) => dataService.updateFingerprint(id, data),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.fingerprints]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useDeleteFingerprintMutation = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<{ message: string }, Error, string>(
    (id) => dataService.deleteFingerprint(id),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.fingerprints]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

/** Semantic search — a mutation (free-text body, not cached). Used by Phase 2/3 surfacing. */
export const useSearchFingerprintsMutation = (
  options?: UseMutationOptions<TFingerprintSearchResponse, Error, TFingerprintSearchParams>,
) => {
  return useMutation<TFingerprintSearchResponse, Error, TFingerprintSearchParams>(
    (params) => dataService.searchFingerprints(params),
    options,
  );
};

/** AI fact extraction — drafts unconfirmed facts onto known entities; invalidates the list. */
export const useExtractFingerprintFactsMutation = (
  options?: UseMutationOptions<TFingerprintExtractResponse, Error, TFingerprintExtractParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TFingerprintExtractResponse, Error, TFingerprintExtractParams>(
    (params) => dataService.extractFingerprintFacts(params),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.fingerprints]);
        options?.onSuccess?.(...params);
      },
    },
  );
};
