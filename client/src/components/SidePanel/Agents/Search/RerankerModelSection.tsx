import { useEffect, useState } from 'react';
import * as Menu from '@ariakit/react/menu';
import { ChevronDown } from 'lucide-react';
import { Label, DropdownPopup } from '@librechat/client';
import type { UseFormRegister, UseFormSetValue } from 'react-hook-form';
import type { SearchApiKeyFormData } from '~/hooks/Plugins/useAuthSearchTool';
import type { MenuItemProps } from '~/common';
import { useLocalize } from '~/hooks';

/**
 * Lets the user choose which reranker model the web-search pipeline uses, from
 * an admin-curated list (`webSearch.rerankerModels`). Unlike API keys, the model
 * is a preference rather than a credential, so this section is shown even when
 * the reranker itself is system-defined. The chosen value is carried to the
 * backend as the `rerankerModel` field; the empty value means "server default".
 *
 * The selection is mirrored in localStorage purely so the dialog can re-display
 * the last choice — the source of truth stays the server-side plugin auth.
 */
const STORAGE_KEY = 'webSearchRerankerModel';

export default function RerankerModelSection({
  models,
  register,
  setValue,
}: {
  models: string[];
  register: UseFormRegister<SearchApiKeyFormData>;
  setValue: UseFormSetValue<SearchApiKeyFormData>;
}) {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<string>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return stored != null && models.includes(stored) ? stored : '';
  });

  useEffect(() => {
    setValue('rerankerModel', selected);
  }, [selected, setValue]);

  const defaultLabel = localize('com_ui_web_search_reranker_model_default');

  const selectModel = (value: string) => {
    setSelected(value);
    if (typeof localStorage === 'undefined') {
      return;
    }
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const items: MenuItemProps[] = [
    { label: defaultLabel, onClick: () => selectModel('') },
    ...models.map((model) => ({ label: model, onClick: () => selectModel(model) })),
  ];

  return (
    <div className="mb-6">
      <input type="hidden" {...register('rerankerModel')} />
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-md w-fit font-medium">
          {localize('com_ui_web_search_reranker_model')}
        </Label>
        <DropdownPopup
          menuId="reranker-model-dropdown"
          items={items}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          trigger={
            <Menu.MenuButton
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center rounded-md border border-border-light px-3 py-1 text-sm text-text-secondary"
            >
              {selected || defaultLabel}
              <ChevronDown className="ml-1 h-4 w-4" />
            </Menu.MenuButton>
          }
        />
      </div>
      <div className="text-xs text-text-secondary">
        {localize('com_ui_web_search_reranker_model_info')}
      </div>
    </div>
  );
}
