-- Bibliothèque de chaque compte Next Up : une ligne par film ou série suivi.
-- `data` contient l'entrée complète (titre, plateforme, épisodes vus…).
-- `deleted` garde la trace d'une suppression pour la propager aux autres appareils.

create table if not exists public.library_entries (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.library_entries enable row level security;

-- Chaque utilisateur ne voit et ne modifie que sa propre bibliothèque.
drop policy if exists "Lire sa bibliothèque" on public.library_entries;
create policy "Lire sa bibliothèque" on public.library_entries
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Ajouter à sa bibliothèque" on public.library_entries;
create policy "Ajouter à sa bibliothèque" on public.library_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Modifier sa bibliothèque" on public.library_entries;
create policy "Modifier sa bibliothèque" on public.library_entries
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Supprimer de sa bibliothèque" on public.library_entries;
create policy "Supprimer de sa bibliothèque" on public.library_entries
  for delete to authenticated using ((select auth.uid()) = user_id);
