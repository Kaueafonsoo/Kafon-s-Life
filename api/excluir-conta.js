/* "Excluir minha conta" (Ajustes). Apaga os dados do usuário logado e, por último, o próprio usuário no Supabase Auth.

   A ordem importa: transferencias aponta para contas com "on delete restrict" (conta com transferência não pode ser
   apagada), e isso pode barrar a exclusão em cadeia que o Auth faria sozinho. Por isso as transferências saem PRIMEIRO,
   depois o resto dos dados (filhos antes dos pais: faturas e lançamentos antes de cartões e contas) e só então o usuário.
   Se qualquer etapa falhar, a função para ali e o usuário do Auth NÃO é apagado, para a pessoa poder tentar de novo.

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

/** Tabelas do usuário na ordem de exclusão: transferências primeiro, depois filhos antes dos pais. */
const ORDEM_DE_EXCLUSAO = [
  'transferencias',
  'faturas',
  'lancamentos',
  'cartoes',
  'contas',
  'orcamentos',
  'metas',
  'wishlist',
  'push_subscriptions',
  'config',
];

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

  const userId = data.user.id;
  for (const tabela of ORDEM_DE_EXCLUSAO) {
    const { error: erroTabela } = await supabase.from(tabela).delete().eq('user_id', userId);
    if (erroTabela) {
      console.error(`Falha ao apagar ${tabela} do usuário`, userId, erroTabela.message);
      return res.status(500).json({ erro: 'Não foi possível excluir a conta agora.' });
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error('Falha ao excluir usuário', userId, error.message);
    return res.status(500).json({ erro: 'Não foi possível excluir a conta agora.' });
  }
  res.status(200).json({ ok: true });
};

module.exports.ORDEM_DE_EXCLUSAO = ORDEM_DE_EXCLUSAO;
