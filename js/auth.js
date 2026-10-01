// Comptes Next Up (Supabase Auth).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const anonKey = SUPABASE_ANON_KEY;
export const functionUrl = (name) => `${SUPABASE_URL}/functions/v1/${name}`;

let client = null;
let session = null;
const listeners = new Set();

export async function init() {
  if (!enabled) return;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  session = (await client.auth.getSession()).data.session;
  client.auth.onAuthStateChange((_event, next) => {
    const changed = next?.user?.id !== session?.user?.id;
    session = next;
    if (changed) listeners.forEach((fn) => fn(next?.user || null));
  });
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

export async function signOut() {
  await client.auth.signOut();
}
