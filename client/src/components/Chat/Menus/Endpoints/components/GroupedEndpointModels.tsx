import React, { useMemo } from 'react';
import type { Endpoint } from '~/common';
import { useLocalize } from '~/hooks';
import { EndpointModelItem } from './EndpointModelItem';
import { groupModelsByModality, modalityLabelKey } from '../modality';

interface GroupedEndpointModelsProps {
  endpoint: Endpoint;
  models: Array<{ name: string; isGlobal?: boolean }>;
  endpointIndex?: number;
}

/**
 * Renders a custom endpoint's models grouped by modality (Text / Image / Video
 * / Audio) with lightweight section headers. Utility models (embeddings, rerank,
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

  // A single group doesn't need a header.
  const showHeaders = groups.length > 1;

  return (
    <>
      {groups.map((group) => (
        <React.Fragment key={group.modality}>
          {showHeaders && (
            <div
              role="presentation"
              className="cursor-default px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-secondary first:pt-1"
            >
              {localize(modalityLabelKey(group.modality))}
            </div>
          )}
          {group.models.map((model, modelIndex) => (
            <EndpointModelItem
              key={`${endpoint.value}${indexSuffix}-${group.modality}-${model.name}-${modelIndex}`}
              modelId={model.name}
              endpoint={endpoint}
            />
          ))}
        </React.Fragment>
      ))}
    </>
  );
}
