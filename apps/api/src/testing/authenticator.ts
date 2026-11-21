import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// A software WebAuthn authenticator for integration tests: it builds the same registration and
// assertion answers a browser returns, signed with a real P-256 key (attestation "none").

type CborValue = number | string | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

function cborHead(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  if (length < 65_536) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  const head = Buffer.alloc(5);
  head[0] = (major << 5) | 26;
  head.writeUInt32BE(length, 1);
  return head;
}

function cbor(value: CborValue): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([cborHead(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([cborHead(4, value.length), ...value.map(cbor)]);
  const parts: Buffer[] = [cborHead(5, value.size)];
  for (const [key, entry] of value) parts.push(cbor(key), cbor(entry));
  return Buffer.concat(parts);
}

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export interface AuthenticatorOptions {
  rpId: string;
  origin: string;
  /** Synced passkeys always report a zero counter. */
  synced?: boolean;
  /** Set false to simulate a browser that skipped user verification. */
  userVerified?: boolean;
}

interface Credential {
  id: Buffer;
  privateKey: KeyObject;
  cosePublicKey: Buffer;
  userHandle: string;
  counter: number;
}

export class SoftwareAuthenticator {
  private readonly credentials: Credential[] = [];
  private readonly aaguid = Buffer.alloc(16);

  constructor(private readonly options: AuthenticatorOptions) {}

  private flags(extra: number) {
    let flags = FLAG_UP | extra;
    if (this.options.userVerified !== false) flags |= FLAG_UV;
    if (this.options.synced) flags |= FLAG_BE | FLAG_BS;
    return flags;
  }

  private authData(flags: number, counter: number, attested?: Buffer): Buffer {
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(counter, 0);
    return Buffer.concat([
      sha256(this.options.rpId),
      Buffer.from([flags]),
      counterBytes,
      ...(attested ? [attested] : []),
    ]);
  }

  private clientData(type: string, challenge: string, origin?: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: origin ?? this.options.origin,
        crossOrigin: false,
      }),
    );
  }

  /** Answers navigator.credentials.create() for the given server options. */
  register(serverOptions: Record<string, unknown>, overrides: { origin?: string } = {}) {
    const user = serverOptions.user as { id: string };
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cosePublicKey = cbor(
      new Map<CborValue, CborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const id = randomBytes(32);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(id.length, 0);
    const attested = Buffer.concat([this.aaguid, idLength, id, cosePublicKey]);
    const counter = this.options.synced ? 0 : 1;
    const authData = this.authData(this.flags(FLAG_AT), counter, attested);
    const attestationObject = cbor(
      new Map<CborValue, CborValue>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    this.credentials.push({ id, privateKey, cosePublicKey, userHandle: user.id, counter });
    return {
      id: b64url(id),
      rawId: b64url(id),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(
          this.clientData('webauthn.create', String(serverOptions.challenge), overrides.origin),
        ),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** Answers navigator.credentials.get(); uses the first (or the given) stored credential. */
  authenticate(
    serverOptions: Record<string, unknown>,
    overrides: { origin?: string; credentialIndex?: number; counter?: number } = {},
  ) {
    const credential = this.credentials[overrides.credentialIndex ?? 0];
    if (!credential) throw new Error('no credential stored in the software authenticator');
    if (overrides.counter !== undefined) credential.counter = overrides.counter;
    else if (!this.options.synced) credential.counter += 1;
    const authData = this.authData(this.flags(0), credential.counter);
    const clientDataJSON = this.clientData(
      'webauthn.get',
      String(serverOptions.challenge),
      overrides.origin,
    );
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      credential.privateKey,
    );
    return {
      id: b64url(credential.id),
      rawId: b64url(credential.id),
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: credential.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
