import {
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { ApiError } from '../api/client';

// Browser side of the passkey ceremonies; the server verifies everything (ADR 0003).

function cancelled(error: unknown): never {
  if (error instanceof ApiError) throw error;
  // NotAllowedError: the person cancelled, or the browser timed out.
  throw new ApiError(0, 'passkey_cancelled');
}

export async function createPasskey(options: unknown): Promise<RegistrationResponseJSON> {
  try {
    return await startRegistration({
      optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
    });
  } catch (error) {
    return cancelled(error);
  }
}

export async function signWithPasskey(
  options: unknown,
  autofill = false,
): Promise<AuthenticationResponseJSON> {
  try {
    return await startAuthentication({
      optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      useBrowserAutofill: autofill,
    });
  } catch (error) {
    return cancelled(error);
  }
}
