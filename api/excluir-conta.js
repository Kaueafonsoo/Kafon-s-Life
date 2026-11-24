/* "Excluir minha conta" (Ajustes). Apaga o usuário logado do Supabase Auth; todas as tabelas do app têm
   "user_id ... on delete cascade", então lançamentos, contas, cartões, faturas, transferências, orçamentos, metas,
   desejos, configurações e inscrições de notificação somem juntos, na mesma operação.

   Só o próprio usuário pode apagar a própria conta: o token do login (Bearer) é validado no servidor e o id a apagar
   sai dele, nunca do corpo da requisição. Exige também { confirmar: true } para não dispararem por engano.
   Precisa aceitar chamadas do app Android/iPhone, que rodam em outra "origem" (CORS). */

const { criarSupabase } = require('./_comum');

const ORIGENS_PERMITIDAS = [
  'https://kafon-s-life.vercel.app',
  'capacitor://localhost',   // iPhone
  'https://localhost',       // Android
  'http://localhost',
];

function liberarOrigem(req, res) {
  const origem = req.headers.origin;
  if (origem && ORIGENS_PERMITIDAS.includes(origem)) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
}

module.exports = async (req, res) => {
  liberarOrigem(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ erro: 'Servidor ainda não configurado.' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ erro: 'não autenticado' });

  let corpo = req.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch (e) { corpo = {}; } }
  if (!corpo || corpo.confirmar !== true) return res.status(400).json({ erro: 'confirmação ausente' });

  const supabase = criarSupabase();
  const { data, error: erroAuth } = await supabase.auth.getUser(token);
  if (erroAuth || !data || !data.user) return res.status(401).json({ erro: 'sessão inválida' });

  const { error } = await supabase.auth.admin.deleteUser(data.user.id);
  if (error) {
    console.error('Falha ao excluir usuário', data.user.id, error.message);
    return res.status(500).json({ erro: 'Não foi possível excluir a conta agora.' });
  }
  res.status(200).json({ ok: true });
};
