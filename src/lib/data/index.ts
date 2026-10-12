/**
 * Picks the backend from environment variables. With none set, the app runs on the local
 * adapter so `npm install && npm run dev` works with no credentials at all.
 *
 *   VITE_DATA_BACKEND=supabase
 *   VITE_SUPABASE_URL=https://xyz.supabase.co
 *   VITE_SUPABASE_ANON_KEY=…
 */
import type { DataStore } from './store';
import { createLocalStore } from './local';

export type { DataStore } from './store';
export { StoreError } from './store';

let instance: Promise<DataStore> | null = null;

export function backendKind(): 'local' | 'supabase' {
  const env = import.meta.env;
  return env.VITE_DATA_BACKEND === 'supabase' && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? 'supabase' : 'local';
}

/** The app's single DataStore. The Supabase client is only downloaded when it is used. */
export function getStore(): Promise<DataStore> {
  if (!instance) {
    instance =
      backendKind() === 'supabase'
        ? import('./supabase').then((m) => m.createSupabaseStore(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY))
        : Promise.resolve(createLocalStore());
  }
  return instance;
}
