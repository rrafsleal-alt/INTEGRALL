(() => {
  'use strict';

  const STORAGE_KEY = 'integrall_age_verified_v1';
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function verified() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || raw.ok !== true) return false;
      const at = Date.parse(raw.at || '');
      if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS) return false;
      return true;
    } catch {
      return false;
    }
  }

  function remember() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ok: true, at: new Date().toISOString()})); } catch {}
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildGate() {
    const gate = el('div', 'age-gate');
    gate.id = 'ageGate';
    gate.setAttribute('role', 'dialog');
    gate.setAttribute('aria-modal', 'true');
    gate.setAttribute('aria-labelledby', 'ageGateTitle');

    const card = el('div', 'age-gate-card');
    card.append(el('p', 'age-gate-brand', 'INTEGRALL'));
    const title = el('h2', 'age-gate-title', 'Você tem 18 anos ou mais?');
    title.id = 'ageGateTitle';
    card.append(title);

    const actions = el('div', 'age-gate-actions');
    const yes = el('button', 'btn primary', 'Sim');
    yes.type = 'button';
    yes.id = 'ageGateYes';
    const no = el('button', 'btn ghost', 'Não');
    no.type = 'button';
    no.id = 'ageGateNo';
    actions.append(yes, no);
    card.append(actions);

    const denied = el('p', 'age-gate-denied', 'Acesso permitido apenas para maiores de 18 anos.');
    denied.id = 'ageGateDenied';
    denied.hidden = true;
    card.append(denied);

    card.append(el('p', 'age-gate-footnote', 'Venda de bebidas alcoólicas proibida para menores de 18 anos.'));
    gate.append(card);

    yes.addEventListener('click', () => {
      remember();
      gate.classList.add('age-gate-leaving');
      document.documentElement.classList.remove('age-locked');
      setTimeout(() => gate.remove(), 250);
    });

    no.addEventListener('click', () => {
      denied.hidden = false;
      actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
    });

    return gate;
  }

  function init() {
    if (verified()) return;
    document.documentElement.classList.add('age-locked');
    const gate = buildGate();
    document.body.prepend(gate);
    gate.querySelector('#ageGateYes')?.focus();
  }

  globalThis.__integrallAgeGate = Object.freeze({verified});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
