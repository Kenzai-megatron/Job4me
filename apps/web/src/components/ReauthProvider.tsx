import { Alert, Button, Dialog, TextField } from '@job4me/ui';
import {
  type FormEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { signWithPasskey } from '../auth/webauthn';
import { errorMessage } from './errors';

type WithReauth = <T>(action: () => Promise<T>) => Promise<T>;

const ReauthContext = createContext<WithReauth | null>(null);

/** Runs a sensitive action; if the server asks for a fresh check, confirms identity then retries. */
export function useWithReauth(): WithReauth {
  const context = useContext(ReauthContext);
  if (!context) throw new Error('ReauthProvider is missing');
  return context;
}

interface Pending {
  resolve: () => void;
  reject: (error: unknown) => void;
}

export function ReauthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pending = useRef<Pending | null>(null);

  const withReauth = useCallback<WithReauth>(async (action) => {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'reauth_required')) throw error;
      await new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setOpen(true);
      });
      return action();
    }
  }, []);

  const finish = (success: boolean) => {
    setOpen(false);
    const current = pending.current;
    pending.current = null;
    if (success) current?.resolve();
    else current?.reject(new ApiError(403, 'reauth_required'));
  };

  return (
    <ReauthContext.Provider value={withReauth}>
      {children}
      <ReauthDialog open={open} onDone={finish} />
    </ReauthContext.Provider>
  );
}

function ReauthDialog({ open, onDone }: { open: boolean; onDone: (success: boolean) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'passkey' | 'password'>('passkey');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      setPassword('');
      setCode('');
      onDone(true);
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  const withPasskey = () =>
    run(async () => {
      const { options } = await api.post<{ options: unknown }>('/api/auth/reauth/passkey/options');
      const response = await signWithPasskey(options);
      await api.post('/api/auth/reauth/passkey/verify', { response });
    });

  const withPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(() => api.post('/api/auth/reauth/password', { password, code }));
  };

  return (
    <Dialog open={open} onClose={() => onDone(false)} title={t('reauth.title')}>
      <p className="text-muted">{t('reauth.intro')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {mode === 'passkey' ? (
        <div className="flex flex-col gap-3">
          <Button onClick={() => void withPasskey()} loading={busy} block>
            {t('reauth.passkey')}
          </Button>
          <Button variant="ghost" onClick={() => setMode('password')} block>
            {t('reauth.usePassword')}
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={withPassword}>
          <TextField
            label={t('reauth.password')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <TextField
            label={t('reauth.code')}
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          <Button type="submit" loading={busy} block>
            {t('reauth.submit')}
          </Button>
        </form>
      )}
      <Button variant="secondary" onClick={() => onDone(false)} block>
        {t('common.cancel')}
      </Button>
    </Dialog>
  );
}
