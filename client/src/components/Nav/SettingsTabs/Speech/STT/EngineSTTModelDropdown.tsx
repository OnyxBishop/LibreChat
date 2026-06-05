import React, { useEffect, useMemo } from 'react';
import { useRecoilState } from 'recoil';
import { Dropdown } from '@librechat/client';
import { useGetCustomConfigSpeechQuery } from 'librechat-data-provider/react-query';
import { useLocalize } from '~/hooks';
import store from '~/store';

interface EngineSTTModelDropdownProps {
  external: boolean;
}

/**
 * Lets the user pick which external STT (Whisper) model to use, from the
 * admin-curated allowlist (`speech.stt.openai.models`). The empty value means
 * "use the server default". Only shown when external STT is configured and the
 * admin exposed an allowlist. The choice rides along the `/speech/stt` request
 * as a FormData `model` field (see useSpeechToTextExternal).
 */
const EngineSTTModelDropdown: React.FC<EngineSTTModelDropdownProps> = ({ external }) => {
  const localize = useLocalize();
  const { data } = useGetCustomConfigSpeechQuery();
  const [engineSTTModel, setEngineSTTModel] = useRecoilState<string>(store.engineSTTModel);

  const sttModels = useMemo(() => data?.sttModels ?? [], [data?.sttModels]);

  /** Drop a stale selection that is no longer in the allowlist. */
  useEffect(() => {
    if (engineSTTModel && sttModels.length > 0 && !sttModels.includes(engineSTTModel)) {
      setEngineSTTModel('');
    }
  }, [engineSTTModel, sttModels, setEngineSTTModel]);

  if (!external || sttModels.length === 0) {
    return null;
  }

  const options = [
    { value: '', label: localize('com_nav_engine_stt_model_server_default') },
    ...sttModels.map((model) => ({ value: model, label: model })),
  ];

  const labelId = 'engine-stt-model-dropdown-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>{localize('com_nav_engine_stt_model')}</div>
      <Dropdown
        value={engineSTTModel}
        onChange={setEngineSTTModel}
        options={options}
        sizeClasses="w-[180px]"
        testId="EngineSTTModelDropdown"
        className="z-50"
        aria-labelledby={labelId}
      />
    </div>
  );
};

export default EngineSTTModelDropdown;
