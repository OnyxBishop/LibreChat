/* Skills */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { UseQueryOptions, UseMutationOptions, QueryObserverResult } from '@tanstack/react-query';
import type {
  TSkill,
  TCreateSkill,
  TUpdateSkill,
  TSkillsResponse,
  TSkillFilesResponse,
} from 'librechat-data-provider';

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

export const useImportSkillMutation = (options?: UseMutationOptions<TSkill, Error, FormData>) => {
  const queryClient = useQueryClient();
  return useMutation<TSkill, Error, FormData>((formData) => dataService.importSkill(formData), {
    ...options,
    onSuccess: (...params) => {
      queryClient.invalidateQueries([QueryKeys.skills]);
      options?.onSuccess?.(...params);
    },
  });
};

/* Skill bundle files */
export const useGetSkillFilesQuery = (
  id: string,
  config?: UseQueryOptions<TSkillFilesResponse>,
): QueryObserverResult<TSkillFilesResponse> => {
  return useQuery<TSkillFilesResponse>(
    [QueryKeys.skills, id, 'files'],
    () => dataService.getSkillFiles(id),
    {
      enabled: !!id,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export type UploadSkillFileParams = { id: string; formData: FormData };
export const useUploadSkillFileMutation = (
  options?: UseMutationOptions<TSkillFilesResponse, Error, UploadSkillFileParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSkillFilesResponse, Error, UploadSkillFileParams>(
    ({ id, formData }) => dataService.uploadSkillFile(id, formData),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.setQueryData([QueryKeys.skills, variables.id, 'files'], data);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export type DeleteSkillFileParams = { id: string; name: string };
export const useDeleteSkillFileMutation = (
  options?: UseMutationOptions<TSkillFilesResponse, Error, DeleteSkillFileParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<TSkillFilesResponse, Error, DeleteSkillFileParams>(
    ({ id, name }) => dataService.deleteSkillFile(id, name),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.setQueryData([QueryKeys.skills, variables.id, 'files'], data);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};
