import React, { useMemo } from 'react';
import { Type, Image as ImageIcon, Video, AudioLines } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Endpoint } from '~/common';
import { useLocalize } from '~/hooks';
import { CustomMenu as Menu } from '../CustomMenu';
import { EndpointModelItem } from './EndpointModelItem';
import { groupModelsByModality, modalityLabelKey } from '../modality';
import type { ChatModality } from '../modality';

const MODALITY_ICONS: Record<ChatModality, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
};

interface GroupedEndpointModelsProps {
  endpoint: Endpoint;
  models: Array<{ name: string; isGlobal?: boolean }>;
  endpointIndex?: number;
}

/**
 * Renders a custom endpoint's models grouped by modality, each as its own nested
 * dropdown (Text / Image / Video / Audio). Utility models (embeddings, rerank,
 * moderation) are filtered out — they can't be used as a chat model and belong
 * in their own places (e.g. a reranker in the web-search settings).
 *
 * Used only for the browse view (no active search); when the user types in the
 * endpoint search box the menu falls back to a flat filtered list.
 */
export function GroupedEndpointModels({
  endpoint,
  models,
  endpointIndex,
}: GroupedEndpointModelsProps) {
  const localize = useLocalize();
  const groups = useMemo(() => groupModelsByModality(models), [models]);
  const indexSuffix = endpointIndex != null ? `-${endpointIndex}` : '';

  // Nothing classified into a chat modality (e.g. only utility models) — fall
  // back to a flat list so the endpoint never renders empty.
  if (groups.length === 0) {
    return (
      <>
        {models.map((model, modelIndex) => (
          <EndpointModelItem
            key={`${endpoint.value}${indexSuffix}-${model.name}-${modelIndex}`}
            modelId={model.name}
            endpoint={endpoint}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {groups.map((group) => {
        const Icon = MODALITY_ICONS[group.modality];
        return (
          <Menu
            id={`modality-${endpoint.value}${indexSuffix}-${group.modality}-menu`}
            key={`modality-${endpoint.value}${indexSuffix}-${group.modality}`}
            className="transition-opacity duration-200 ease-in-out"
            label={
              <div className="group flex w-full flex-shrink cursor-pointer items-center justify-between rounded-xl px-1 py-1 text-sm">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                  <span className="truncate text-left">
                    {localize(modalityLabelKey(group.modality))}
                  </span>
                </div>
              </div>
            }
          >
            {group.models.map((model, modelIndex) => (
              <EndpointModelItem
                key={`${endpoint.value}${indexSuffix}-${group.modality}-${model.name}-${modelIndex}`}
                modelId={model.name}
                endpoint={endpoint}
              />
            ))}
          </Menu>
        );
      })}
    </>
  );
}
