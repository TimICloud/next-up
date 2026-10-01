// Comptes Next Up (Supabase Auth).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const anonKey = SUPABASE_ANON_KEY;
export const functionUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;

let client = null;
let session = null;
let ready = false;
let recovery = false;
let linkError = null;
const listeners = new Set();

// Arrivée depuis le lien « mot de passe oublié » : l'utilisateur doit choisir un nouveau mot de passe.
export const isRecovery = () => recovery;
// Lien expiré ou déjà utilisé (renvoyé par Supabase dans l'adresse).
export const takeLinkError = () => {
  const e = linkError;
  linkError = null;
  return e;
};

export async function init() {
  if (!enabled) return;
  const hash = location.hash;
  if (/type=recovery/.test(hash)) recovery = true;
  const error = /error_code=([^&]+)/.exec(hash);
  if (error) {
    linkError = decodeURIComponent(error[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  // Flux « implicit » : le lien reçu par e-mail fonctionne même s'il s'ouvre dans un autre navigateur.
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'implicit' } });
  client.auth.onAuthStateChange((event, next) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    const changed = next?.user?.id !== session?.user?.id;
    session = next;
    if (ready && changed) listeners.forEach((fn) => fn(next?.user || null));
  });
  session = (await client.auth.getSession()).data.session;
  ready = true;
}

export const onChange = (fn) => listeners.add(fn);
export const db = () => client;
export const user = () => session?.user || null;
export const token = () => session?.access_token || null;
export const displayName = () => user()?.user_metadata?.name || user()?.email?.split('@')[0] || '';

const MESSAGES = [
  [/invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
  [/already registered|already exists/i, 'Un compte existe déjà avec cet e-mail.'],
  [/password should be at least|weak password/i, 'Le mot de passe doit faire au moins 6 caractères.'],
  [/email not confirmed/i, 'Confirme d’abord ton e-mail grâce au lien reçu.'],
  [/invalid email|unable to validate email/i, 'Cette adresse e-mail n’est pas valide.'],
  [/rate limit|too many/i, 'Trop de tentatives, réessaie dans quelques minutes.'],
  [/fetch|network/i, 'Pas de connexion internet.'],
  [/different from the old password/i, 'Choisis un mot de passe différent de l’ancien.'],
  [/reauthentication|session.*missing|not authenticated/i, 'Le lien a expiré. Demande un nouveau lien.'],
];
const frenchError = (error) => new Error(MESSAGES.find(([re]) => re.test(error.message))?.[1] || error.message);

// Renvoie 'signed-in', ou 'confirm-email' si Supabase demande de confirmer l'adresse.
export async function signUp(email, password, name) {
  const { data, error } = await client.auth.signUp({
    email, password,
    options: { data: { name }, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw frenchError(error);
  return data.session ? 'signed-in' : 'confirm-email';
}

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw frenchError(error);
}

export async function resetPassword(email) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw frenchError(error);
}

export async function updatePassword(password) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw frenchError(error);
  recovery = false;
}

// Suppression définitive du compte et de sa bibliothèque, par la fonction serveur « delete-account ».
export async function deleteAccount() {
  const res = await fetch(functionUrl('delete-account'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, apikey: anonKey },
  });
  if (!res.ok) throw new Error('La suppression a échoué. Réessaie dans un instant.');
  // Le compte n'existe plus côté serveur : on ferme la session sur cet appareil.
  await client.auth.signOut({ scope: 'local' });
}

export const updateName = (name) => updateMeta({ name });

// Préférences du compte (prénom, abonnements…), retrouvées sur tous les appareils.
export async function updateMeta(meta) {
  const { data, error } = await client.auth.updateUser({ data: meta });
  if (error) throw frenchError(error);
  // Même utilisateur : on met à jour la session sans déclencher de resynchronisation.
  if (session) session = { ...session, user: data.user };
}

// Déconnexion : sur tous les appareils si possible, sinon (hors ligne…) au moins sur celui-ci.
export async function signOut() {
  const { error } = await client.auth.signOut();
  if (error) await client.auth.signOut({ scope: 'local' });
}
