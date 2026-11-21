import { Logo } from '@job4me/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { Icon, type IconName } from './icons';

const SECTIONS: Array<{ to: string; key: string; icon: IconName }> = [
  { to: '/', key: 'nav.home', icon: 'home' },
  { to: '/offers', key: 'nav.offers', icon: 'offers' },
  { to: '/applications', key: 'nav.applications', icon: 'applications' },
  { to: '/documents', key: 'nav.documents', icon: 'documents' },
  { to: '/profile', key: 'nav.profile', icon: 'profile' },
];

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** Bottom bar on the phone, sidebar on the computer (SPEC section 9). */
export function AppShell() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    queryClient.clear();
    await navigate({ to: '/login' });
  };

  const linkClasses = (bottom: boolean) =>
    clsx(
      'flex items-center gap-3 rounded-md font-medium hover:bg-surface-muted',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      bottom ? 'min-h-14 flex-1 flex-col justify-center gap-1 text-xs' : 'min-h-11 px-3 text-base',
    );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
      >
        {t('app.skipToContent')}
      </a>

      <aside className="hidden border-r border-line bg-surface md:flex md:flex-col md:gap-6 md:p-4">
        <Link to="/" className="px-3 py-2">
          <Logo />
        </Link>
        <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
          {SECTIONS.map((section) => (
            <Link
              key={section.to}
              to={section.to}
              activeOptions={{ exact: section.to === '/' }}
              activeProps={{ 'aria-current': 'page', className: 'bg-accent-soft text-accent' }}
              inactiveProps={{ className: 'text-muted hover:text-ink' }}
              className={linkClasses(false)}
            >
              <Icon name={section.icon} />
              {t(section.key)}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1 border-t border-line pt-4">
          <Link
            to="/settings/security"
            activeProps={{ 'aria-current': 'page', className: 'bg-accent-soft text-accent' }}
            inactiveProps={{ className: 'text-muted hover:text-ink' }}
            className={linkClasses(false)}
          >
            <Icon name="settings" />
            {t('nav.settings')}
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className={`${linkClasses(false)} text-muted hover:text-ink`}
          >
            <Icon name="logout" />
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-2 md:hidden">
          <Link to="/" className="py-2">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <Link
              to="/settings/security"
              aria-label={t('nav.settings')}
              className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-ink"
            >
              <Icon name="settings" />
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label={t('nav.logout')}
              className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-ink"
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>

        {online ? null : (
          <p role="status" className="bg-surface-muted px-4 py-2 text-sm text-ink">
            {t('app.offline')}
          </p>
        )}

        <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-8 md:py-10">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {SECTIONS.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            activeOptions={{ exact: section.to === '/' }}
            activeProps={{ 'aria-current': 'page', className: 'text-accent' }}
            inactiveProps={{ className: 'text-muted hover:text-ink' }}
            className={linkClasses(true)}
          >
            <Icon name={section.icon} />
            {t(section.key)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
