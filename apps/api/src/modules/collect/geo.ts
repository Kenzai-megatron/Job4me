import { Gazetteer, type Place } from '@job4me/collect';
import type { Settings } from '@job4me/config';
import type { BaseLocation } from '@job4me/contracts';
import {
  type Database,
  eq,
  type OfferGeo,
  readLocalities,
  schema,
  type Transaction,
} from '@job4me/db';

// Geography on the API side (ADR 0017): the Belgian localities, read once per database, the base
// city of a profile, and where distances are measured from.

const loaded = new WeakMap<Database, Promise<Gazetteer>>();

/** The localities loaded by the migration, read at the first need. */
export function gazetteerOf(db: Database, settings: Settings): Promise<Gazetteer> {
  let loading = loaded.get(db);
  if (!loading) {
    loading = readLocalities(db).then((rows) => new Gazetteer(rows, settings.geo));
    // A failed read is tried again at the next need.
    loading.catch(() => loaded.delete(db));
    loaded.set(db, loading);
  }
  return loading;
}

/** The base city of an account's profile, read in the localities. */
export async function baseOf(
  tx: Transaction,
  userId: string,
  gazetteer: Gazetteer,
): Promise<{ place: Place; given: boolean }> {
  const [profile] = await tx
    .select({ city: schema.profiles.baseCity, code: schema.profiles.basePostalCode })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId));
  const city = profile?.city ?? null;
  const code = profile?.code ?? null;
  return { place: gazetteer.locateBase(city, code), given: Boolean(city || code) };
}

/** Where distances are measured from: the base city, when the localities know it. */
export function offerGeo(base: Place, settings: Settings): OfferGeo {
  return {
    base: base.status === 'found' ? { latitude: base.latitude, longitude: base.longitude } : null,
    roadFactor: settings.geo.roadFactor,
  };
}

/** What the profile screen shows of the base city: « Bruxelles, 1000 : trouvée ». */
export function baseLocation(base: { place: Place; given: boolean }): BaseLocation {
  if (!base.given) return { status: 'missing', name: null, postalCode: null };
  if (base.place.status !== 'found') {
    return { status: base.place.status, name: null, postalCode: null };
  }
  return { status: 'found', name: base.place.name, postalCode: base.place.postalCode };
}
