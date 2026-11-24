/* GRANA — camada nativa (só roda dentro do app Android/iPhone feito com Capacitor).
   No site, este arquivo nem é carregado: o scripts/montar-app.js só o coloca na pasta www/.

   Como funciona: o app.js continua igual ao do site. Aqui a gente troca, só dentro do app,
   as funções que dependem de recursos de navegador que não existem (ou funcionam mal)
   num app instalado:
     - Face ID / digital  -> biometria nativa do celular
     - lembretes das 21h  -> notificação local (funciona com o app fechado, sem servidor)
     - exportar PDF       -> gera o arquivo e abre o "compartilhar" do celular
     - links externos     -> abrem no navegador do sistema
     - botão voltar (Android), barra de status e tela de abertura */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import html2pdf from 'html2pdf.js';
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

  /* ---------- PDF: gera o arquivo e abre o "compartilhar" ---------- */
  const estiloPdf = document.createElement('style');
  estiloPdf.textContent = `
    .pdf-nativo { position: fixed; left: -10000px; top: 0; width: 760px; background: #fff; padding: 32px; color: #0B0B0B; font-family: var(--font); }
    .pdf-nativo .print-header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #0B0B0B; padding-bottom: 12px; margin-bottom: 20px; }
    .pdf-nativo .print-brand { font-family: var(--font-display); font-weight: 700; font-size: 15px; letter-spacing: 0.08em; }
    .pdf-nativo .print-header h1 { font-family: var(--font-display); font-size: 20px; margin: 0; }
    .pdf-nativo .print-summary { display: flex; gap: 32px; margin-bottom: 24px; }
    .pdf-nativo .print-summary div { display: flex; flex-direction: column; gap: 3px; }
    .pdf-nativo .print-summary span { font-size: 11px; color: #57554C; text-transform: uppercase; letter-spacing: 0.04em; }
    .pdf-nativo .print-summary strong { font-family: var(--font-display); font-size: 17px; }
    .pdf-nativo section { margin-bottom: 22px; }
    .pdf-nativo h2 { font-family: var(--font-display); font-size: 13px; margin: 0 0 10px; }
    .pdf-nativo table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .pdf-nativo th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #57554C; padding: 5px 8px; border-bottom: 1px solid #ccc; }
    .pdf-nativo td { padding: 5px 8px; border-bottom: 1px solid #e4e2dc; }
    .pdf-nativo th:last-child, .pdf-nativo td:last-child { text-align: right; }
    .pdf-nativo tr { page-break-inside: avoid; }
    .pdf-nativo .print-valor.receita { color: #0d6b3f; }
    .pdf-nativo .print-valor.despesa { color: #a3251d; }
    .pdf-nativo .print-footer { margin-top: 24px; font-size: 10px; color: #8A887F; }`;
  document.head.appendChild(estiloPdf);

  // O app.js monta o relatório em #print-report e chama window.print(). Aqui o "imprimir" vira PDF + compartilhar.
  window.print = async function () {
    const origem = document.getElementById('print-report');
    const clone = document.createElement('div');
    clone.className = 'pdf-nativo';
    clone.innerHTML = origem.innerHTML;
    document.body.appendChild(clone);
    try {
      showToast('Gerando o PDF…', 6000);
      const titulo = (clone.querySelector('h1') || {}).textContent || 'relatorio';
      const nomeArquivo = `GRANA - ${titulo}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
      const dataUri = await html2pdf()
        .set({ margin: 10, filename: nomeArquivo, html2canvas: { scale: 2, backgroundColor: '#ffffff' }, jsPDF: { unit: 'mm', format: 'a4' }, pagebreak: { mode: ['css', 'legacy'] } })
        .from(clone)
        .outputPdf('datauristring');
      const base64 = dataUri.split(',')[1];
      const arquivo = await Filesystem.writeFile({ path: nomeArquivo, data: base64, directory: Directory.Cache });
      await Share.share({ title: nomeArquivo, url: arquivo.uri, dialogTitle: 'Salvar ou enviar o relatório' });
    } catch (err) {
      if (!/cancel/i.test(String(err && err.message))) showToast('Não deu pra gerar o PDF. Tente de novo.');
    } finally {
      clone.remove();
    }
  };

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
