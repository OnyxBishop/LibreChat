import React, { memo } from 'react';
import { ImagePlus } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

/**
 * Toggle that, when enabled, attaches the most recent image in the conversation
 * to every new user message — letting the user edit one picture over several
 * turns. The actual injection happens at submit time in `useChatFunctions`.
 */
function AttachLastImage() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  if (!context) {
    return null;
  }
  const { toggleState, debouncedChange } = context.attachLastImage;
  const checked = toggleState === true;

  return (
    <CheckboxButton
      className="max-w-fit"
      checked={checked}
      setValue={debouncedChange}
      label={localize('com_ui_attach_last_image')}
      isCheckedClassName="border-purple-600/40 bg-purple-500/10 hover:bg-purple-700/10"
      icon={<ImagePlus className="icon-md" aria-hidden="true" />}
    />
  );
}

export default memo(AttachLastImage);
