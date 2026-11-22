import type { Settings } from '@job4me/config';
import type { AppDeps } from '../../context';

export function clock(deps: AppDeps): () => Date {
  return deps.now ?? (() => new Date());
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

/** Durations from config/default.yaml, in milliseconds. */
export function authDurations(settings: Settings) {
  const auth = settings.auth;
  return {
    idleMs: auth.session.idleTimeoutMinutes * 60_000,
    absoluteMs: auth.session.absoluteTimeoutHours * 3_600_000,
    reauthMs: auth.session.reauthWindowMinutes * 60_000,
    touchMs: auth.session.touchIntervalSeconds * 1000,
    challengeMs: auth.challengeMinutes * 60_000,
    passwordStepMs: auth.passwordStepMinutes * 60_000,
    enrollmentMs: auth.enrollmentLinkMinutes * 60_000,
  };
}
