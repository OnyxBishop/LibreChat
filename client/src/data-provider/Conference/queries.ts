/* Conference sessions */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { UseQueryOptions, UseMutationOptions, QueryObserverResult } from '@tanstack/react-query';
import type {
  TConferenceSession,
  TCreateConferenceSession,
  TUpdateConferenceSession,
  TConferenceSessionsResponse,
} from 'librechat-data-provider';

export const useGetConferenceSessionsQuery = (
  config?: UseQueryOptions<TConferenceSessionsResponse>,
): QueryObserverResult<TConferenceSessionsResponse> => {
  return useQuery<TConferenceSessionsResponse>(
    [QueryKeys.conferenceSessions],
    () => dataService.getConferenceSessions(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useCreateConferenceSessionMutation = (
  options?: UseMutationOptions<TConferenceSession, Error, TCreateConferenceSession>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TConferenceSession, Error, TCreateConferenceSession>(
    (data) => dataService.createConferenceSession(data),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.conferenceSessions]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export type UpdateConferenceSessionParams = { id: string; data: TUpdateConferenceSession };
export const useUpdateConferenceSessionMutation = (
  options?: UseMutationOptions<TConferenceSession, Error, UpdateConferenceSessionParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TConferenceSession, Error, UpdateConferenceSessionParams>(
    ({ id, data }) => dataService.updateConferenceSession(id, data),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.conferenceSessions]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useDeleteConferenceSessionMutation = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<{ message: string }, Error, string>(
    (id) => dataService.deleteConferenceSession(id),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.conferenceSessions]);
        options?.onSuccess?.(...params);
      },
    },
  );
};
