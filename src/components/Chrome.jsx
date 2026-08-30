import { useI18n } from '../i18n.jsx';

export function Brand() {
  const { t } = useI18n();
  return (
    <a className="brand" href="/" aria-label={t('brandHome')}>
      <img alt="Likerts" height="32" src="/logo-likerts.png" width="140" />
    </a>
  );
}
