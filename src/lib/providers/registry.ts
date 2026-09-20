/**
 * Which provider serves which capability for a sport.
 *
 * The order is: the per-sport preference from Settings, then the built-in
 * default order. Only configured providers count, and the mock provider is
 * used exclusively while MOCK_SPORTS=true so demo data never mixes with real.
 */

import { env } from '@/lib/env';
import { MockProvider } from '@/lib/providers/mock';
import type { Capability, ProviderKey, SportsDataProvider } from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';

const registry = new Map<ProviderKey, SportsDataProvider>();

export function registerProvider(provider: SportsDataProvider): void {
  registry.set(provider.key, provider);
}

registerProvider(new MockProvider());

/** Built-in preference per sport, best data source first. */
const DEFAULT_ORDER: Record<string, ProviderKey[]> = {
  football: ['football-data', 'api-sports', 'thesportsdb', 'football-data-co-uk'],
  rugby_union: ['api-sports', 'thesportsdb', 'espn'],
  rugby_league: ['api-sports', 'thesportsdb', 'espn'],
  cricket: ['cricketdata', 'cricsheet', 'thesportsdb'],
  tennis: ['espn', 'thesportsdb'],
  f1: ['jolpica', 'openf1', 'thesportsdb'],
  basketball: ['espn', 'thesportsdb'],
  american_football: ['espn', 'thesportsdb'],
  ice_hockey: ['espn', 'thesportsdb'],
  baseball: ['espn', 'thesportsdb'],
};

export function allProviders(): SportsDataProvider[] {
  return Array.from(registry.values());
}

export function providerByKey(key: string): SportsDataProvider | undefined {
  return registry.get(key as ProviderKey);
}

/**
 * Providers able to serve `capability` for `sport`, in preference order.
 * `preferred` is the comma-separated list from the sport's settings.
 */
export function providersFor(sport: SportKey, capability: Capability, preferred = ''): SportsDataProvider[] {
  if (env.mockSports) {
    const mock = registry.get('mock');
    return mock && mock.sports.includes(sport) && mock.capabilities.includes(capability) ? [mock] : [];
  }
  const order: ProviderKey[] = [];
  for (const raw of preferred.split(',')) {
    const key = raw.trim() as ProviderKey;
    if (key && registry.has(key) && !order.includes(key)) order.push(key);
  }
  for (const key of DEFAULT_ORDER[sport] ?? []) if (!order.includes(key)) order.push(key);
  for (const key of registry.keys()) if (!order.includes(key)) order.push(key);
  return order
    .map((key) => registry.get(key))
    .filter((provider): provider is SportsDataProvider =>
      Boolean(provider && provider.key !== 'mock' && provider.sports.includes(sport) && provider.capabilities.includes(capability) && provider.configured()),
    );
}

/** The first provider for a capability, or null when none is configured. */
export function primaryProvider(sport: SportKey, capability: Capability, preferred = ''): SportsDataProvider | null {
  return providersFor(sport, capability, preferred)[0] ?? null;
}
