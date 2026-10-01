/* Botão "Enviar notificação de teste" dos Ajustes. Exige o login do próprio usuário (token do Supabase)
   e só envia pros aparelhos dele. */

const { faltando, criarSupabase, configurarPush, enviar } = require('./_comum');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });
  const falta = faltando();
  if (falta.length) return res.status(500).json({ erro: 'Servidor de lembretes ainda não configurado.', falta });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ erro: 'não autenticado' });

  const supabase = criarSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth || !auth.user) return res.status(401).json({ erro: 'sessão inválida' });

  configurarPush();
  const { data: subs, error } = await supabase.from('push_subscriptions')
    .select('endpoint, p256dh, auth').eq('user_id', auth.user.id);
  if (error) return res.status(500).json({ erro: error.message });
  if (!subs.length) return res.status(404).json({ erro: 'Nenhum aparelho com lembretes ativos.' });

  let enviadas = 0;
  for (const sub of subs) {
    if (await enviar(supabase, sub, { title: 'GRANA', body: 'Teste ok! Os lembretes chegam por aqui todo dia às 21h, quando houver algo importante.', url: './' })) enviadas++;
  }
  res.status(200).json({ enviadas, total: subs.length });
};
