import { useTranslation } from 'react-i18next';

export const ExampleComponent = () => {
  const { t } = useTranslation();
  
  return (
    <div>
      <button>{t('common.save')}</button>
      <button>{t('common.cancel')}</button>
    </div>
  );
}; 