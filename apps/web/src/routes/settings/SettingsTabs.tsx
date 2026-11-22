import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** The settings pages: security, then the AI and what it costs. */
export function SettingsTabs() {
  const { t } = useTranslation();
  const tab =
    'inline-flex min-h-11 items-center rounded-md px-4 font-semibold text-muted hover:bg-surface-muted';
  return (
    <nav aria-label={t('settings.tabs')} className="flex flex-wrap gap-2">
      <Link
        to="/settings/security"
        className={tab}
        activeProps={{ className: 'bg-accent-soft text-accent', 'aria-current': 'page' }}
      >
        {t('settings.security')}
      </Link>
      <Link
        to="/settings/ai"
        className={tab}
        activeProps={{ className: 'bg-accent-soft text-accent', 'aria-current': 'page' }}
      >
        {t('settings.ai')}
      </Link>
    </nav>
  );
}
