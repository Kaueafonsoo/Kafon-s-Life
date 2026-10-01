/* Roda todo dia via Vercel Cron (ver vercel.json): às 00:00 UTC = 21:00 em Brasília.
   Pra cada usuário com notificações ativas, olha o banco e só envia se houver algo útil. */

const { faltando, criarSupabase, configurarPush, enviar } = require('./_comum');
const { montarMensagem } = require('./_mensagem');

const FUSO = 'America/Sao_Paulo';

function isoNoFuso(date) {
  // 'en-CA' formata como aaaa-mm-dd
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function somaDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function dadosDoUsuario(supabase, userId, hoje) {
  const amanha = somaDias(hoje, 1);
  const [ano, mes] = hoje.split('-').map(Number);
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const fimMes = `${hoje.slice(0, 7)}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0')}`;

  const [lancouRes, contasRes, mesRes, orcRes, cfgRes] = await Promise.all([
    supabase.from('lancamentos').select('id').eq('user_id', userId)
      .or(`data.eq.${hoje},created_at.gte.${hoje}T00:00:00-03:00`).limit(1),
    supabase.from('lancamentos').select('descricao, data').eq('user_id', userId)
      .eq('tipo', 'despesa').eq('status', 'pendente')
      .gte('data', somaDias(hoje, -30)).lte('data', amanha).order('data'),
    supabase.from('lancamentos').select('categoria, valor').eq('user_id', userId)
      .eq('tipo', 'despesa').gte('data', inicioMes).lte('data', fimMes),
    supabase.from('orcamentos').select('categoria, valor_planejado').eq('user_id', userId),
    supabase.from('config').select('privacidade').eq('user_id', userId).maybeSingle(),
  ]);

  const gasto = {};
  (mesRes.data || []).forEach(l => { gasto[l.categoria] = (gasto[l.categoria] || 0) + Number(l.valor); });
  const orcamento = (orcRes.data || [])
    .filter(o => Number(o.valor_planejado) > 0)
    .map(o => ({ categoria: o.categoria, pct: ((gasto[o.categoria] || 0) / Number(o.valor_planejado)) * 100 }))
    .filter(o => o.pct >= 80)
    .map(o => ({ ...o, estourou: o.pct > 100 }))
    .sort((a, b) => b.pct - a.pct);

  return {
    hoje,
    privacidade: !!(cfgRes.data && cfgRes.data.privacidade),
    lancouHoje: (lancouRes.data || []).length > 0,
    contas: contasRes.data || [],
    orcamento,
  };
}

module.exports = async (req, res) => {
  // A Vercel manda "Authorization: Bearer <CRON_SECRET>" nas chamadas do cron; sem isso qualquer um poderia disparar.
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) {
    return res.status(401).json({ erro: 'não autorizado' });
  }
  const falta = faltando();
  if (falta.length) return res.status(500).json({ erro: 'variáveis de ambiente ausentes', falta });

  configurarPush();
  const supabase = criarSupabase();
  const hoje = isoNoFuso(new Date());

  const { data: subs, error } = await supabase.from('push_subscriptions').select('user_id, endpoint, p256dh, auth');
  if (error) return res.status(500).json({ erro: error.message });

  const porUsuario = {};
  (subs || []).forEach(s => { (porUsuario[s.user_id] = porUsuario[s.user_id] || []).push(s); });

  let enviadas = 0, puladas = 0, falhas = 0;
  for (const [userId, aparelhos] of Object.entries(porUsuario)) {
    try {
      const msg = montarMensagem(await dadosDoUsuario(supabase, userId, hoje));
      if (!msg) { puladas++; continue; }
      for (const sub of aparelhos) {
        (await enviar(supabase, sub, { ...msg, url: './' })) ? enviadas++ : falhas++;
      }
    } catch (err) {
      console.error('Erro no usuário', userId, err.message);
      falhas++;
    }
  }
  res.status(200).json({ hoje, usuarios: Object.keys(porUsuario).length, enviadas, puladas, falhas });
};
