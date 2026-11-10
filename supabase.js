import { exportFullDatabase, importFullDatabase, getAppState, setAppState } from './db.js';

export const SUPABASE_SQL_SNIPPET = `-- Вставь этот код в SQL Editor в бесплатном проекте Supabase и нажми Run:
create table if not exists public.ddx_backups (
  id text primary key,
  updated_at timestamptz default now(),
  payload jsonb not null
);

alter table public.ddx_backups enable row level security;

create policy "Allow public read/write for personal tracker"
on public.ddx_backups for all
using (true)
with check (true);`;

function cleanUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export async function pushToSupabase(customUrl, customKey) {
  const settings = (await getAppState('settings')) || {};
  const url = cleanUrl(customUrl ?? settings.supabaseUrl);
  const key = String(customKey ?? settings.supabaseAnonKey ?? '').trim();

  if (!url || !key) {
    throw new Error('Укажите Supabase Project URL и Anon Key в настройках');
  }

  const snapshot = await exportFullDatabase();
  const endpoint = `${url}/rest/v1/ddx_backups?on_conflict=id`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      id: 'personal_ddx_profile',
      updated_at: new Date().toISOString(),
      payload: snapshot
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ошибка Supabase (${response.status}): ${errText || response.statusText}`);
  }

  const nowIso = new Date().toISOString();
  settings.lastCloudSyncAt = nowIso;
  await setAppState('settings', settings);
  return nowIso;
}

export async function pullFromSupabase(customUrl, customKey) {
  const settings = (await getAppState('settings')) || {};
  const url = cleanUrl(customUrl ?? settings.supabaseUrl);
  const key = String(customKey ?? settings.supabaseAnonKey ?? '').trim();

  if (!url || !key) {
    throw new Error('Укажите Supabase Project URL и Anon Key в настройках');
  }

  const endpoint = `${url}/rest/v1/ddx_backups?id=eq.personal_ddx_profile&select=payload,updated_at`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ошибка загрузки из Supabase (${response.status}): ${errText || response.statusText}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0].payload) {
    throw new Error('В облаке Supabase пока нет сохранённого бэкапа');
  }

  await importFullDatabase(rows[0].payload);

  const updatedSettings = (await getAppState('settings')) || {};
  updatedSettings.supabaseUrl = url;
  updatedSettings.supabaseAnonKey = key;
  updatedSettings.lastCloudSyncAt = rows[0].updated_at || new Date().toISOString();
  await setAppState('settings', updatedSettings);

  return rows[0].updated_at;
}

