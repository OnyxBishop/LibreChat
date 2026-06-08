/* Skills */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { UseQueryOptions, UseMutationOptions, QueryObserverResult } from '@tanstack/react-query';
import type { TSkill, TCreateSkill, TUpdateSkill, TSkillsResponse } from 'librechat-data-provider';

export const useGetSkillsQuery = (
  config?: UseQueryOptions<TSkillsResponse>,
): QueryObserverResult<TSkillsResponse> => {
  return useQuery<TSkillsResponse>([QueryKeys.skills], () => dataService.getSkills(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    ...config,
  });
};

export const useCreateSkillMutation = (
  options?: UseMutationOptions<TSkill, Error, TCreateSkill>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSkill, Error, TCreateSkill>((data) => dataService.createSkill(data), {
    ...options,
    onSuccess: (...params) => {
      queryClient.invalidateQueries([QueryKeys.skills]);
      options?.onSuccess?.(...params);
    },
  });
};

export type UpdateSkillParams = { id: string; data: TUpdateSkill };
export const useUpdateSkillMutation = (
  options?: UseMutationOptions<TSkill, Error, UpdateSkillParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSkill, Error, UpdateSkillParams>(
    ({ id, data }) => dataService.updateSkill(id, data),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.skills]);
        options?.onSuccess?.(...params);
      },
    },
  );
};

export const useDeleteSkillMutation = (
  options?: UseMutationOptions<{ message: string }, Error, string>,
) => {
  const queryClient = useQueryClient();
  return useMutation<{ message: string }, Error, string>((id) => dataService.deleteSkill(id), {
    ...options,
    onSuccess: (...params) => {
      queryClient.invalidateQueries([QueryKeys.skills]);
      options?.onSuccess?.(...params);
    },
  });
};
