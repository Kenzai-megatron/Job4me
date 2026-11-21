import { formatDateTime } from '@job4me/i18n';
import { Alert, Badge, Button, Card, TextField } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { auditQuery, securityQuery, sessionsQuery } from '../../api/queries';
import { createPasskey } from '../../auth/webauthn';
import { errorMessage } from '../../components/errors';
import { NotificationsSection } from '../../components/NotificationsSection';
import { useWithReauth } from '../../components/ReauthProvider';
import { RecoveryCodes } from '../../components/RecoveryCodes';

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card aria-labelledby={id}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {intro ? <p className="text-sm text-muted">{intro}</p> : null}
        </div>
        {children}
      </div>
    </Card>
  );
}

/** Runs a settings action with its own busy and error state. */
function useAction() {
  const { t } = useTranslation();
  const withReauth = useWithReauth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await withReauth(task);
      return true;
    } catch (caught) {
      setError(errorMessage(t, caught));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function SecurityPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const security = useQuery(securityQuery);
  const sessions = useQuery(sessionsQuery);
  const audit = useQuery(auditQuery);
  const refresh = () => queryClient.invalidateQueries();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('security.title')}</h1>
        <p className="text-muted">{t('security.intro')}</p>
      </div>
      {security.isError ? <Alert tone="error">{errorMessage(t, security.error)}</Alert> : null}
      {security.data ? (
        <>
          <PasskeysSection passkeys={security.data.passkeys} onChange={refresh} />
          <TotpSection enabled={security.data.totpEnabled} onChange={refresh} />
          <RecoverySection remaining={security.data.recoveryCodesRemaining} onChange={refresh} />
          <PasswordSection
            fallbackEnabled={security.data.password.fallbackEnabled}
            onChange={refresh}
          />
        </>
      ) : null}
      <SessionsSection sessions={sessions.data?.sessions ?? []} onChange={refresh} />
      <NotificationsSection />
      <AuditSection entries={audit.data?.entries ?? []} />
    </div>
  );
}

function PasskeysSection({
  passkeys,
  onChange,
}: {
  passkeys: Array<{
    id: string;
    name: string;
    provider: string | null;
    backedUp: boolean;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { busy, error, run } = useAction();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const add = () =>
    run(async () => {
      const { options } = await api.post<{ options: unknown }>('/api/auth/passkeys/options');
      const response = await createPasskey(options);
      await api.post('/api/auth/passkeys/verify', { response });
      await onChange();
    });

  const rename = (event: FormEvent, id: string) => {
    event.preventDefault();
    void run(async () => {
      await api.patch(`/api/auth/passkeys/${id}`, { name: newName });
      setRenaming(null);
      await onChange();
    });
  };

  const remove = (id: string) =>
    run(async () => {
      await api.delete(`/api/auth/passkeys/${id}`);
      setConfirmDelete(null);
      await onChange();
    });

  return (
    <Section title={t('security.passkeys.title')} intro={t('security.passkeys.intro')}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="flex flex-col divide-y divide-line">
        {passkeys.map((passkey) => (
          <li key={passkey.id} className="flex flex-col gap-2 py-3 first:pt-0">
            {renaming === passkey.id ? (
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => rename(e, passkey.id)}
              >
                <TextField
                  label={t('security.passkeys.renameLabel')}
                  value={newName}
                  maxLength={64}
                  onChange={(event) => setNewName(event.target.value)}
                  className="flex-1"
                  required
                />
                <Button type="submit" loading={busy}>
                  {t('common.save')}
                </Button>
                <Button variant="secondary" onClick={() => setRenaming(null)}>
                  {t('common.cancel')}
                </Button>
              </form>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{passkey.name}</span>
                  {passkey.provider ? <Badge>{passkey.provider}</Badge> : null}
                  {passkey.backedUp ? (
                    <Badge tone="accent">{t('security.passkeys.synced')}</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted">
                  {t('security.passkeys.created', { date: formatDateTime(passkey.createdAt) })}
                  {' · '}
                  {t('security.passkeys.lastUsed', {
                    date: passkey.lastUsedAt
                      ? formatDateTime(passkey.lastUsedAt)
                      : t('common.never'),
                  })}
                </p>
                {confirmDelete === passkey.id ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm">
                      {t('security.passkeys.deleteConfirm', { name: passkey.name })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        loading={busy}
                        onClick={() => void remove(passkey.id)}
                      >
                        {t('common.delete')}
                      </Button>
                      <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setNewName(passkey.name);
                        setRenaming(passkey.id);
                      }}
                    >
                      {t('common.rename')}
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirmDelete(passkey.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button onClick={() => void add()} loading={busy}>
          {t('security.passkeys.add')}
        </Button>
      </div>
    </Section>
  );
}

function TotpSection({ enabled, onChange }: { enabled: boolean; onChange: () => Promise<void> }) {
  const { t } = useTranslation();
  const { busy, error, run } = useAction();
  const [setup, setSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [code, setCode] = useState('');

  const start = () =>
    run(async () => {
      setSetup(await api.post<{ secret: string; qrCode: string }>('/api/auth/totp/setup'));
    });

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.post('/api/auth/totp/confirm', { code });
      setSetup(null);
      setCode('');
      await onChange();
    });
  };

  return (
    <Section title={t('security.totp.title')} intro={t('security.totp.intro')}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={enabled ? 'accent' : 'neutral'}>
          {enabled ? t('security.totp.enabled') : t('security.totp.disabled')}
        </Badge>
        {setup ? null : (
          <Button variant="secondary" loading={busy} onClick={() => void start()}>
            {enabled ? t('security.totp.reset') : t('security.totp.setup')}
          </Button>
        )}
      </div>
      {setup ? (
        <form className="flex flex-col gap-4" onSubmit={confirm}>
          <p className="text-sm text-muted">{t('enroll.totpIntro')}</p>
          <img
            src={setup.qrCode}
            alt={t('enroll.totpQrAlt')}
            width={240}
            height={240}
            className="rounded-md border border-line bg-white p-2"
          />
          <code className="block break-all rounded-md bg-surface-muted p-3 font-mono text-sm">
            {setup.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
          <TextField
            label={t('enroll.totpCode')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {t('enroll.totpConfirm')}
            </Button>
            <Button variant="secondary" onClick={() => setSetup(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

function RecoverySection({
  remaining,
  onChange,
}: {
  remaining: number;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { busy, error, run } = useAction();
  const [codes, setCodes] = useState<string[] | null>(null);

  const regenerate = () =>
    run(async () => {
      setCodes((await api.post<{ codes: string[] }>('/api/auth/recovery-codes')).codes);
      await onChange();
    });

  return (
    <Section title={t('security.recovery.title')} intro={t('security.recovery.intro')}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p>{t('security.recovery.remaining', { count: remaining })}</p>
      {codes ? (
        <>
          <Alert>{t('enroll.codesIntro')}</Alert>
          <RecoveryCodes codes={codes} />
        </>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted">{t('security.recovery.regenerateConfirm')}</p>
          <Button variant="secondary" loading={busy} onClick={() => void regenerate()}>
            {t('security.recovery.regenerate')}
          </Button>
        </div>
      )}
    </Section>
  );
}

function PasswordSection({
  fallbackEnabled,
  onChange,
}: {
  fallbackEnabled: boolean;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);

  const change = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.post('/api/auth/password/change', { newPassword });
      setNewPassword('');
      setEditing(false);
      setDone(true);
    });
  };

  const toggle = () =>
    run(async () => {
      await api.post('/api/auth/password-fallback', { enabled: !fallbackEnabled });
      await onChange();
    });

  return (
    <Section title={t('security.password.title')} intro={t('security.password.intro')}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {done ? <Alert>{t('security.password.changed')}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={fallbackEnabled ? 'accent' : 'neutral'}>
          {fallbackEnabled ? t('security.password.fallbackOn') : t('security.password.fallbackOff')}
        </Badge>
        <Button variant="secondary" loading={busy} onClick={() => void toggle()}>
          {fallbackEnabled
            ? t('security.password.disableFallback')
            : t('security.password.enableFallback')}
        </Button>
        {editing ? null : (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t('security.password.change')}
          </Button>
        )}
      </div>
      {editing ? (
        <form className="flex flex-col gap-3" onSubmit={change}>
          <TextField
            label={t('security.password.newPassword')}
            hint={t('security.password.newPasswordHint')}
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy}>
              {t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </Section>
  );
}

function SessionsSection({
  sessions,
  onChange,
}: {
  sessions: Array<{
    id: string;
    authMethod: 'passkey' | 'password_totp' | 'password_recovery';
    userAgentLabel: string | null;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
  }>;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { busy, error, run } = useAction();
  const [message, setMessage] = useState<string | null>(null);

  const revoke = (id: string) =>
    run(async () => {
      await api.delete(`/api/auth/sessions/${id}`);
      await onChange();
    });

  const revokeOthers = () =>
    run(async () => {
      const { revoked } = await api.post<{ revoked: number }>('/api/auth/sessions/revoke-others');
      setMessage(t('security.sessions.revoked', { count: revoked }));
      await onChange();
    });

  return (
    <Section title={t('security.sessions.title')}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {message ? <Alert>{message}</Alert> : null}
      <ul className="flex flex-col divide-y divide-line">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0"
          >
            <div className="flex flex-col">
              <span className="flex flex-wrap items-center gap-2 font-semibold">
                {session.userAgentLabel ?? t('security.sessions.unknownDevice')}
                {session.current ? (
                  <Badge tone="accent">{t('security.sessions.current')}</Badge>
                ) : null}
              </span>
              <span className="text-sm text-muted">
                {t(`authMethods.${session.authMethod}`)}
                {' · '}
                {t('security.sessions.lastSeen', { date: formatDateTime(session.lastSeenAt) })}
              </span>
            </div>
            {session.current ? null : (
              <Button variant="secondary" loading={busy} onClick={() => void revoke(session.id)}>
                {t('security.sessions.revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 ? (
        <div>
          <Button variant="secondary" loading={busy} onClick={() => void revokeOthers()}>
            {t('security.sessions.revokeOthers')}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

function AuditSection({
  entries,
}: {
  entries: Array<{
    id: number;
    occurredAt: string;
    action: string;
    outcome: 'success' | 'failure' | 'denied';
  }>;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t('security.audit.title')} intro={t('security.audit.intro')}>
      {entries.length === 0 ? <p className="text-muted">{t('security.audit.empty')}</p> : null}
      <ol className="flex flex-col divide-y divide-line">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0"
          >
            <span>
              {t(`audit.actions.${entry.action}`, { defaultValue: t('audit.actions.unknown') })}
            </span>
            <span className="text-sm text-muted tabular-nums">
              {t(`audit.outcomes.${entry.outcome}`)}
              {' · '}
              {formatDateTime(entry.occurredAt)}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
