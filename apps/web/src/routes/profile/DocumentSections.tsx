import type { Identity } from '@job4me/contracts';
import { Alert, Button, CheckboxGroup, SelectField, TextAreaField, TextField } from '@job4me/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { identityQuery, type ProfileResponse, profileQuery } from '../../api/profile';
import { errorMessage } from '../../components/errors';
import { practicalOptions } from './fields';
import { ProfileSection } from './ProfileSection';

/** Saves a form with its own busy, error and confirmation state. */
function useSave() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, saved, save };
}

function SaveRow({ busy, error, saved }: { busy: boolean; error: string | null; saved: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>
          {t('profile.actions.save')}
        </Button>
        {saved ? (
          <p role="status" className="text-sm text-muted">
            {t('profile.saved')}
          </p>
        ) : null}
      </div>
    </>
  );
}

const list = (text: string) =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
const orNull = (text: string) => (text.trim() === '' ? null : text.trim());

function IdentityForm({ initial }: { initial: Identity }) {
  const { t } = useTranslation();
  const { busy, error, saved, save } = useSave();
  const [fullName, setFullName] = useState(initial.fullName ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [commune, setCommune] = useState(initial.commune ?? '');
  const [licences, setLicences] = useState(initial.drivingLicences.join(', '));
  const [transport, setTransport] = useState<string[]>(initial.transport);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(() =>
      api.put('/api/profile/identity', {
        fullName: orNull(fullName),
        email: orNull(email),
        phone: orNull(phone),
        commune: orNull(commune),
        drivingLicences: list(licences).map((licence) => licence.toUpperCase()),
        transport,
      }),
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <TextField
        label={t('profile.fields.fullName')}
        autoComplete="name"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
      />
      <TextField
        label={t('profile.fields.email')}
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label={t('profile.fields.phone')}
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      <TextField
        label={t('profile.fields.commune')}
        autoComplete="address-level2"
        value={commune}
        onChange={(event) => setCommune(event.target.value)}
      />
      <TextField
        label={t('profile.fields.drivingLicences')}
        hint={t('profile.hints.drivingLicences')}
        value={licences}
        onChange={(event) => setLicences(event.target.value)}
      />
      <CheckboxGroup
        legend={t('profile.fields.transport')}
        options={practicalOptions.transportModes.map((value) => ({
          value,
          label: t(`profile.options.transport.${value}`),
        }))}
        value={transport}
        onChange={setTransport}
      />
      <SaveRow busy={busy} error={error} saved={saved} />
    </form>
  );
}

/**
 * The base city as the localities read it (ADR 0017): « Bruxelles, 1000 : trouvée », or why
 * distances cannot be measured. Read again after each save.
 */
function BaseCityCheck() {
  const { t } = useTranslation();
  const profile = useQuery(profileQuery);
  const base = profile.data?.baseLocation;
  if (!base || base.status === 'missing') return null;
  return (
    <div className="flex flex-col gap-1 text-sm" role="status">
      {base.status === 'found' ? (
        <p>{t('profile.base.found', { name: base.name, postalCode: base.postalCode })}</p>
      ) : (
        <p className="text-danger">{t(`profile.base.${base.status}`)}</p>
      )}
      <p className="text-muted">
        {t('profile.base.attribution')}{' '}
        <a
          href="https://www.geonames.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-4"
        >
          {t('profile.base.geonames')}
        </a>{' '}
        {t('profile.base.license')}
      </p>
    </div>
  );
}

function PracticalForm({ initial }: { initial: ProfileResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { busy, error, saved, save } = useSave();
  const [baseCity, setBaseCity] = useState(initial.baseCity ?? '');
  const [postalCode, setPostalCode] = useState(initial.basePostalCode ?? '');
  const [radius, setRadius] = useState(initial.radiusKm === null ? '' : String(initial.radiusKm));
  const [contracts, setContracts] = useState<string[]>(initial.contractTypes);
  const [regimes, setRegimes] = useState<string[]>(initial.workRegimes);
  const [remote, setRemote] = useState(initial.remotePreference ?? '');
  const [salary, setSalary] = useState(
    initial.salaryMinMonthly === null ? '' : String(initial.salaryMinMonthly),
  );
  const [available, setAvailable] = useState(initial.availableFrom ?? '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(async () => {
      await api.patch('/api/profile', {
        baseCity: orNull(baseCity),
        basePostalCode: orNull(postalCode),
        radiusKm: radius.trim() === '' ? null : Number(radius),
        contractTypes: contracts,
        workRegimes: regimes,
        remotePreference: orNull(remote),
        salaryMinMonthly: salary.trim() === '' ? null : Number(salary),
        availableFrom: orNull(available),
      });
      // Distances are measured from the base city: the offers show them again.
      await queryClient.invalidateQueries({ queryKey: ['offers'] });
      await queryClient.invalidateQueries({ queryKey: ['offer'] });
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <TextField
        label={t('profile.fields.baseCity')}
        value={baseCity}
        onChange={(event) => setBaseCity(event.target.value)}
      />
      <TextField
        label={t('profile.fields.basePostalCode')}
        hint={t('profile.hints.basePostalCode')}
        inputMode="numeric"
        pattern="[0-9]{4}"
        value={postalCode}
        onChange={(event) => setPostalCode(event.target.value)}
      />
      <BaseCityCheck />
      <TextField
        label={t('profile.fields.radiusKm')}
        hint={t('profile.hints.radiusKm', { km: initial.defaultRadiusKm })}
        type="number"
        inputMode="numeric"
        min={1}
        max={300}
        value={radius}
        onChange={(event) => setRadius(event.target.value)}
      />
      <CheckboxGroup
        legend={t('profile.fields.contractTypes')}
        options={practicalOptions.contractTypes.map((value) => ({
          value,
          label: t(`profile.options.contractTypes.${value}`),
        }))}
        value={contracts}
        onChange={setContracts}
      />
      <CheckboxGroup
        legend={t('profile.fields.workRegimes')}
        options={practicalOptions.workRegimes.map((value) => ({
          value,
          label: t(`profile.options.workRegimes.${value}`),
        }))}
        value={regimes}
        onChange={setRegimes}
      />
      <SelectField
        label={t('profile.fields.remotePreference')}
        emptyLabel={t('profile.none')}
        options={practicalOptions.remotePreferences.map((value) => ({
          value,
          label: t(`profile.options.remotePreferences.${value}`),
        }))}
        value={remote}
        onChange={(event) => setRemote(event.target.value)}
      />
      <TextField
        label={t('profile.fields.salaryMinMonthly')}
        type="number"
        inputMode="numeric"
        min={0}
        max={100000}
        value={salary}
        onChange={(event) => setSalary(event.target.value)}
      />
      <TextField
        label={t('profile.fields.availableFrom')}
        type="date"
        value={available}
        onChange={(event) => setAvailable(event.target.value)}
      />
      <SaveRow busy={busy} error={error} saved={saved} />
    </form>
  );
}

function MotivationsForm({ initial }: { initial: ProfileResponse }) {
  const { t } = useTranslation();
  const { busy, error, saved, save } = useSave();
  const [motivations, setMotivations] = useState(initial.motivations ?? '');
  const [tags, setTags] = useState(initial.motivationTags.join(', '));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(() =>
      api.patch('/api/profile', { motivations: orNull(motivations), motivationTags: list(tags) }),
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <TextAreaField
        label={t('profile.fields.motivations')}
        value={motivations}
        onChange={(event) => setMotivations(event.target.value)}
      />
      <TextField
        label={t('profile.fields.motivationTags')}
        hint={t('profile.hints.tags')}
        value={tags}
        onChange={(event) => setTags(event.target.value)}
      />
      <SaveRow busy={busy} error={error} saved={saved} />
    </form>
  );
}

function Loading({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return children ?? <p className="text-sm text-muted">{t('common.loading')}</p>;
}

export function IdentitySection() {
  const { t } = useTranslation();
  const identity = useQuery(identityQuery);
  return (
    <ProfileSection
      id="profile-identity"
      title={t('profile.rubrics.identity')}
      intro={t('profile.intros.identity')}
    >
      {/* Read again on arrival: a reviewed import may have changed it since the cache. */}
      <Loading>
        {identity.data && identity.isFetchedAfterMount ? (
          <IdentityForm initial={identity.data} />
        ) : null}
      </Loading>
    </ProfileSection>
  );
}

export function PracticalSection() {
  const { t } = useTranslation();
  const profile = useQuery(profileQuery);
  return (
    <ProfileSection
      id="profile-practical"
      title={t('profile.rubrics.practical')}
      intro={t('profile.intros.practical')}
    >
      <Loading>
        {profile.data && profile.isFetchedAfterMount ? (
          <PracticalForm initial={profile.data} />
        ) : null}
      </Loading>
    </ProfileSection>
  );
}

export function MotivationsSection() {
  const { t } = useTranslation();
  const profile = useQuery(profileQuery);
  return (
    <ProfileSection
      id="profile-motivations"
      title={t('profile.rubrics.motivations')}
      intro={t('profile.intros.motivations')}
    >
      <Loading>
        {profile.data && profile.isFetchedAfterMount ? (
          <MotivationsForm initial={profile.data} />
        ) : null}
      </Loading>
    </ProfileSection>
  );
}
