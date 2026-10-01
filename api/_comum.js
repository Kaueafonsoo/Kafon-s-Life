const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sepfduogwhekhrjonoyp.supabase.co';

function faltando() {
  return ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !process.env[k]);
}

/** Cliente com a chave de serviço: ignora o RLS, por isso só existe aqui no servidor, nunca no navegador. */
function criarSupabase() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function configurarPush() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:contato@grana.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/** Envia pra uma inscrição. Se o aparelho não existe mais (404/410), apaga a inscrição do banco. */
async function enviar(supabase, sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    } else {
      console.error('Falha ao enviar push:', err.statusCode, err.body || err.message);
    }
    return false;
  }
}

module.exports = { faltando, criarSupabase, configurarPush, enviar };
