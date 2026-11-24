/* GRANA — camada nativa (só roda dentro do app Android/iPhone feito com Capacitor).
   No site, este arquivo nem é carregado: o scripts/montar-app.js só o coloca na pasta www/.

   Como funciona: o app.js continua igual ao do site. Aqui a gente troca, só dentro do app,
   as funções que dependem de recursos de navegador que não existem (ou funcionam mal)
   num app instalado:
     - Face ID / digital  -> biometria nativa do celular
     - lembretes das 21h  -> notificação local (funciona com o app fechado, sem servidor)
     - links externos     -> abrem no navegador do sistema
     - botão voltar (Android), barra de status e tela de abertura */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Browser } from '@capacitor/browser';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
// Mesma lógica do servidor e do Resumo: o aviso é igual no push, no lembrete local e na tela.
import { planejarLembretes } from '../api/_planejar.js';

if (Capacitor.isNativePlatform()) {
  const ANDROID = Capacitor.getPlatform() === 'android';
  document.documentElement.classList.add('app-nativo', ANDROID ? 'app-android' : 'app-ios');

  /* ---------- Service worker: não é usado dentro do app ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register = () => Promise.resolve();
  }

  /* ---------- Barra de status acompanha o tema ---------- */
  const aplicarTemaOriginal = window.aplicarTema;
  window.aplicarTema = function (tema) {
    aplicarTemaOriginal(tema);
    // Style.Light = texto escuro (para fundo claro); Style.Dark = texto claro (para fundo escuro)
    StatusBar.setStyle({ style: tema === 'escuro' ? Style.Dark : Style.Light }).catch(() => {});
    if (ANDROID) {
      StatusBar.setBackgroundColor({ color: tema === 'escuro' ? '#0F0D0B' : '#FDFDFC' }).catch(() => {});
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => SplashScreen.hide().catch(() => {}), 150);
  });

  /* ---------- Face ID / digital nativos ---------- */
  const NOME_BIOMETRIA = ANDROID ? 'digital' : 'Face ID';

  window.faceIdDisponivel = async function () {
    try {
      const r = await NativeBiometric.isAvailable();
      return !!(r && r.isAvailable);
    } catch {
      return false;
    }
  };

  async function confirmarBiometria(motivo) {
    await NativeBiometric.verifyIdentity({
      reason: motivo,
      title: 'GRANA',
      subtitle: motivo,
      negativeButtonText: 'Cancelar',
      useFallback: true,
    });
  }

  window.ativarFaceId = async function () {
    try {
      await confirmarBiometria('Ativar a trava do GRANA');
      localStorage.setItem(FACEID_CRED_KEY, 'nativo');
      localStorage.setItem(FACEID_ENABLED_KEY, '1');
      showToast(`Trava com ${NOME_BIOMETRIA} ativada neste aparelho`);
    } catch {
      showToast('Não foi confirmado. Tente de novo.');
    }
    atualizarBotaoFaceId();
  };

  const atualizarBotaoOriginal = window.atualizarBotaoFaceId;
  window.atualizarBotaoFaceId = async function () {
    await atualizarBotaoOriginal();
    const btn = document.getElementById('btn-faceid-toggle');
    if (btn && ANDROID) btn.textContent = faceIdEstaAtivo() ? 'Desativar trava com digital' : 'Ativar trava com digital';
  };

  window.tentarDesbloquear = async function () {
    if (!localStorage.getItem(FACEID_CRED_KEY)) { hideLockScreen(); return; }
    try {
      await confirmarBiometria('Desbloquear o GRANA');
      hideLockScreen();
    } catch {
      // cancelou: a tela continua travada, com o botão para tentar de novo
    }
  };

  // No app dá para pedir a biometria sozinho quando ele volta para a frente
  App.addListener('appStateChange', ({ isActive }) => {
    if (!appStarted || !faceIdEstaAtivo()) return;
    if (!isActive) showLockScreen();
    else if (!document.getElementById('lock-screen').hidden) tentarDesbloquear();
  });

  /* ---------- Lembretes das 21h com notificação local ---------- */
  const LEMBRETES_KEY = 'grana_lembretes_nativo';
  const ID_LEMBRETE = 2100;          // 2100 a 2106: um por noite, nos próximos 7 dias
  const DIAS_AGENDADOS = 7;

  const idsLembretes = () => Array.from({ length: DIAS_AGENDADOS }, (_, i) => ({ id: ID_LEMBRETE + i }));

  let timerAgendar = null;
  /** Agenda os avisos das 21h dos próximos 7 dias (quais e com que texto: api/_planejar.js, a mesma lógica do servidor).
      Toda vez que os dados mudam isso é refeito. */
  async function agendarLembrete() {
    if (localStorage.getItem(LEMBRETES_KEY) !== '1') return;
    try {
      await LocalNotifications.cancel({ notifications: idsLembretes() });
      const plano = planejarLembretes({
        agora: new Date(), dias: DIAS_AGENDADOS,
        lancamentos: state.lancamentos || [], cartoes: state.cartoes || [], faturas: state.faturas || [],
        orcamentos: state.orcamentos || {}, privacidade: !!state.config.privacidade,
      });
      if (plano.length) {
        await LocalNotifications.schedule({
          notifications: plano.map(p => ({ id: ID_LEMBRETE + p.indice, title: p.title, body: p.body, schedule: { at: p.quando, allowWhileIdle: true } })),
        });
      }
    } catch { /* lembrete nunca pode travar o app */ }
  }
  function agendarEmBreve() {
    clearTimeout(timerAgendar);
    timerAgendar = setTimeout(agendarLembrete, 800);
  }

  // Toda vez que a tela é redesenhada (dados mudaram), o aviso de hoje é recalculado.
  const renderAllOriginal = window.renderAll;
  window.renderAll = function () {
    renderAllOriginal();
    agendarEmBreve();
  };

  window.pushSuportado = () => true;
  window.inscricaoAtual = async () => (localStorage.getItem(LEMBRETES_KEY) === '1' ? { nativo: true } : null);

  window.atualizarLembretesUI = async function () {
    const row = document.getElementById('lembretes-row');
    const btn = document.getElementById('btn-lembretes-toggle');
    const hint = document.getElementById('lembretes-hint');
    row.hidden = false;
    let permissao = 'prompt';
    try { permissao = (await LocalNotifications.checkPermissions()).display; } catch {}
    const ativo = localStorage.getItem(LEMBRETES_KEY) === '1' && permissao === 'granted';
    btn.disabled = false;
    btn.textContent = ativo ? 'Desativar lembretes' : 'Ativar lembretes';
    hint.textContent = permissao === 'denied'
      ? 'As notificações estão bloqueadas para o GRANA. Libere nos Ajustes do celular → Notificações.'
      : 'Um aviso por dia, às 21h, só quando houver algo importante: conta ou fatura do cartão vencendo (3 dias e 1 dia antes), orçamento no limite ou nenhum gasto lançado no dia. Vale só para este aparelho.';
  };

  window.ativarLembretes = async function () {
    try {
      const { display } = await LocalNotifications.requestPermissions();
      if (display !== 'granted') {
        showToast('Sem a permissão de notificações não dá pra ativar os lembretes.');
      } else {
        localStorage.setItem(LEMBRETES_KEY, '1');
        await agendarLembrete();
        showToast('Lembretes ativados neste aparelho');
      }
    } catch (err) {
      showToast('Não deu pra ativar os lembretes: ' + (err.message || 'tente de novo'));
    }
    atualizarLembretesUI();
  };

  async function cancelarLembretes() {
    localStorage.removeItem(LEMBRETES_KEY);
    try { await LocalNotifications.cancel({ notifications: idsLembretes() }); } catch {}
  }

  window.desativarLembretes = async function () {
    await cancelarLembretes();
    showToast('Lembretes desativados neste aparelho');
    atualizarLembretesUI();
  };

  window.removerInscricaoAoSair = cancelarLembretes;

  /* ---------- Links externos abrem no navegador do celular ---------- */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      Browser.open({ url: href }).catch(() => {});
    }
  }, true);

  /* ---------- Botão voltar do Android ---------- */
  App.addListener('backButton', () => {
    const modalAberto = [...document.querySelectorAll('.modal-overlay')].find(m => !m.hidden);
    if (modalAberto) { closeModal(modalAberto.id); return; }
    const resumo = document.getElementById('tab-resumo');
    if (resumo && !resumo.classList.contains('is-active')) { switchTab('resumo'); return; }
    App.minimizeApp().catch(() => {});
  });
}
