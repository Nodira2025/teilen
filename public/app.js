import { bankTargets, normalize, numeric, money, percent, formatCuit, maskedCuit, periodLabel, suggestedCuit, compareProducts, csvCell } from './domain.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { report: null, products: null, rows: [], shown: 12, loadingProducts: false, lookupController: null, lookupGeneration: 0, query: null, activeTab: 'lookup' };
const situationLabels = { 1: 'Situación normal', 2: 'Seguimiento especial / riesgo bajo', 3: 'Con problemas / riesgo medio', 4: 'Alto riesgo', 5: 'Irrecuperable', 6: 'Irrecuperable por disposición técnica' };
const flagLabels = { refinanciaciones: 'Refinanciación', recategorizacionOblig: 'Recategorización obligatoria', situacionJuridica: 'Situación jurídica', irrecDisposicionTecnica: 'Disposición técnica', enRevision: 'Dato en revisión', procesoJud: 'Dato bajo proceso judicial' };
const dateTime = value => new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : 'Sin fecha';
const pill = (text, tone = '') => `<span class="pill ${tone}">${escape(text)}</span>`;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 5000); }

async function api(path, options = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 27000);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const response = await fetch(path, { ...options, signal, cache: 'no-store' });
    if (response.status === 429) throw new Error('Se alcanzó el límite de consultas. Esperá un minuto e intentá nuevamente.');
    let body; try { body = await response.json(); } catch { throw new Error('El servidor respondió en un formato inesperado.'); }
    if (!response.ok) { const error = new Error(body.error || 'No se pudo completar la consulta.'); error.code = body.code; throw error; }
    return body;
  } catch (error) {
    if (error.name === 'AbortError' && !options.signal?.aborted) throw new Error('La consulta demoró demasiado. Intentá nuevamente.');
    if (error instanceof TypeError) throw new Error('No se pudo conectar. Revisá tu conexión e intentá nuevamente.');
    throw error;
  } finally { clearTimeout(timer); }
}

function updateAccess(auth = { required: false }) {
  $('access-panel').hidden = !auth.required;
  $('access-form').hidden = !auth.configured || auth.authenticated;
  $('access-logout').hidden = !auth.authenticated;
  $('lookup-submit').disabled = Boolean(auth.required && !auth.authenticated);
  $('access-title').textContent = auth.authenticated ? 'Sesión iniciada' : 'Ingresá para consultar';
  $('access-status').textContent = !auth.configured ? 'El administrador todavía debe habilitar el acceso. Podés recorrer el ejemplo y el comparador.' : auth.authenticated ? 'Podés realizar consultas propias o autorizadas. La sesión dura hasta 8 horas.' : 'Usá la clave que te proporcionó el administrador.';
}
async function loadAccess() {
  try { const health = await api('/api/health'); $('runtime-badge').textContent = health.mode === 'local' ? 'Piloto local' : 'Piloto en línea'; updateAccess(health.auth); }
  catch (error) { toast(error.message + ' Recargá la página para reintentar.'); }
}
$('access-form').addEventListener('submit', async event => {
  event.preventDefault(); $('access-submit').disabled = true; $('access-error').hidden = true;
  try {
    await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('access-password').value }) });
    updateAccess({ required: true, configured: true, authenticated: true });
    $('document').focus();
  } catch (error) { $('access-error').textContent = error.message; $('access-error').hidden = false; }
  finally { $('access-password').value = ''; $('access-submit').disabled = false; }
});
$('access-logout').addEventListener('click', async () => {
  clearReport();
  try { await api('/api/logout', { method: 'POST' }); updateAccess({ required: true, configured: true, authenticated: false }); }
  catch (error) { toast(error.message); }
});

function setTab(name) {
  state.activeTab = name;
  for (const tab of ['lookup', 'products']) {
    const active = tab === name;
    $(`tab-${tab}`).classList.toggle('active', active); $(`tab-${tab}`).setAttribute('aria-selected', String(active)); $(`tab-${tab}`).tabIndex = active ? 0 : -1;
    $(`panel-${tab}`).hidden = !active;
  }
  if (name === 'products' && !state.products && !state.loadingProducts) loadProducts();
}
for (const name of ['lookup', 'products']) {
  $(`tab-${name}`).addEventListener('click', () => setTab(name));
  $(`tab-${name}`).addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const other = event.key === 'Home' ? 'lookup' : event.key === 'End' ? 'products' : name === 'lookup' ? 'products' : 'lookup'; setTab(other); $(`tab-${other}`).focus();
    }
  });
}
$('sources-open').addEventListener('click', () => $('sources-dialog').showModal());
$('sources-close').addEventListener('click', () => $('sources-dialog').close());

function updateIdentity() {
  const digits = $('document').value.replace(/[.\s-]/g, ''); const dni = /^\d{7,8}$/.test(digits);
  $('dni-extra').hidden = !dni; $('prefix').required = dni; $('confirm-identity').required = dni; $('confirm-identity').checked = false;
  const cuit = suggestedCuit($('document').value, $('prefix').value);
  $('suggestion').textContent = cuit ? `CUIL calculado: ${formatCuit(cuit)}` : $('prefix').value && dni ? 'Revisá el prefijo o ingresá el CUIL completo.' : 'Completá el prefijo para calcularlo.';
  $('confirm-identity').disabled = dni && !cuit;
  $('form-error').hidden = true;
}
$('document').addEventListener('input', updateIdentity); $('prefix').addEventListener('change', updateIdentity);

function clearReport({ reset = true } = {}) {
  state.lookupGeneration++; state.lookupController?.abort(); state.lookupController = null; state.report = null;
  $('report').replaceChildren(); $('report').hidden = true; $('empty-report').hidden = false; $('lookup-progress').hidden = true; $('clear-report').hidden = true; $('form-error').hidden = true; $('lookup-fields').disabled = false; $('demo-button').disabled = false;
  if (reset) { $('lookup-form').reset(); updateIdentity(); $('document').focus(); }
}
$('clear-report').addEventListener('click', () => clearReport());
$('lookup-form').addEventListener('submit', async event => {
  event.preventDefault(); clearReport({ reset: false });
  const generation = state.lookupGeneration; const controller = new AbortController(); state.lookupController = controller;
  const body = { document: $('document').value, prefix: $('prefix').value, confirmedIdentity: $('confirm-identity').checked, consent: $('consent').checked };
  $('lookup-fields').disabled = true; $('demo-button').disabled = true; $('empty-report').hidden = true; $('lookup-progress').hidden = false; $('clear-report').hidden = false;
  try {
    const report = await api('/api/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (generation !== state.lookupGeneration) return;
    state.report = report; renderReport();
  } catch (error) {
    if (generation !== state.lookupGeneration || controller.signal.aborted) return;
    if (error.code === 'AUTH_REQUIRED') updateAccess({ required: true, configured: true, authenticated: false });
    $('form-error').textContent = error.message; $('form-error').hidden = false; $('empty-report').hidden = false;
  } finally {
    if (generation === state.lookupGeneration) { $('lookup-progress').hidden = true; $('lookup-fields').disabled = false; $('demo-button').disabled = false; state.lookupController = null; }
  }
});
$('demo-button').addEventListener('click', async () => {
  clearReport({ reset: false }); const generation = state.lookupGeneration;
  try { const report = await api('/api/demo'); if (generation !== state.lookupGeneration) return; state.report = report; renderReport(); if (innerWidth < 760) $('report').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (error) { toast(error.message); }
});

function reportSummary(report) {
  const current = report.sources.current; const latest = current.periods?.[0]; const situation = latest?.worstSituation;
  if (current.status === 'unavailable') return { title: 'No se pudo consultar la situación actual', text: current.message, tone: 'warning', symbol: '!' };
  if (current.status === 'no_records' || !latest?.entities.length) return { title: 'Sin registros en la consulta actual', text: 'El BCRA no devolvió deudas para este CUIT/CUIL. Esto no acredita ausencia de deudas ni valida la identidad del titular.', tone: 'neutral', symbol: '⌕' };
  if (situation == null) return { title: 'Información parcial de la fuente', text: 'Hay registros, pero falta una clasificación reconocible. Revisá el detalle antes de continuar.', tone: 'warning', symbol: '!' };
  return { title: `Situación ${situation} · ${situationLabels[situation]}`, text: 'Mayor clasificación informada entre las entidades del último período. Es información del BCRA, no una decisión de aprobación bancaria.', tone: situation === 1 ? '' : situation === 2 ? 'warning' : 'danger', symbol: situation === 1 ? '✓' : '!' };
}
function renderReport() {
  const r = state.report; const { current, history, checks } = r.sources; const latest = current.periods?.[0]; const summary = reportSummary(r);
  const name = current.name || history.name || checks.name; const unavailable = Object.values(r.sources).filter(s => s.status === 'unavailable').length;
  $('empty-report').hidden = true; $('report').hidden = false; $('clear-report').hidden = false;
  const currentTable = latest?.entities.length ? `<section class="card report-section"><h3>Entidades informantes</h3><div class="table-wrap"><table><thead><tr><th>Entidad</th><th>Situación</th><th class="align-right">Monto informado</th></tr></thead><tbody>${latest.entities.map(e => `<tr><td>${escape(e.name)}${e.flags.length ? `<small>${e.flags.map(f => escape(flagLabels[f] || f)).join(' · ')}</small>` : ''}${e.delayDays > 0 ? `<small>Atraso informado: ${e.delayDays} días</small>` : ''}</td><td>${pill(e.situation === null ? 'No informada' : String(e.situation), e.situation === 1 ? 'green' : e.situation === 2 ? 'amber' : e.situation ? 'red' : '')}</td><td class="align-right">${escape(money(e.amount))}</td></tr>`).join('')}</tbody></table></div><p class="help">Montos convertidos de miles de pesos a pesos. Un atraso de 0 en la fuente puede significar “no aplicable”.</p></section>` : '';
  $('report').innerHTML = `${r.demo ? '<div class="demo-banner">EJEMPLO FICTICIO · Estos datos no corresponden a una persona real.</div>' : ''}<div class="report-topline"><div>${name ? `<div class="person-name">${escape(name)}</div>` : ''}<span>CUIT/CUIL ${escape(maskedCuit(r.cuit))}</span></div><span>Consultado ${escape(dateTime(r.consultedAt))}</span></div><div class="report-banner ${summary.tone}"><span class="result-symbol" aria-hidden="true">${summary.symbol}</span><div><h3>${escape(summary.title)}</h3><p>${escape(summary.text)}</p></div></div>${unavailable ? `<div class="error-note">${unavailable} fuente${unavailable > 1 ? 's' : ''} sin respuesta disponible. El informe está incompleto; podés volver a consultar.</div>` : ''}<div class="report-metrics"><div class="card metric"><span>Deuda informada · último período</span><strong>${escape(money(latest?.total))}</strong><small>No equivale al saldo de cancelación.</small></div><div class="card metric"><span>Entidades con información</span><strong>${latest ? latest.entities.length : '—'}</strong><small>${escape(periodLabel(latest?.period))}</small></div><div class="card metric"><span>Cheques rechazados</span><strong>${checks.status === 'found' ? checks.count : checks.status === 'no_records' ? 'Sin registros' : 'No disponible'}</strong><small>${checks.status === 'found' ? `${checks.unpaidCount} sin fecha de pago informada` : 'Fuente independiente de las deudas.'}</small></div></div>${currentTable}${historySection(history)}${checksSection(checks)}<div class="source-status">${[['Deudas', current], ['Historial', history], ['Cheques', checks]].map(([label, source]) => `<span>${label}: <b class="${source.status === 'unavailable' ? 'failed' : ''}">${source.status === 'found' ? 'respondió' : source.status === 'no_records' ? 'sin registros' : 'no disponible'}</b>${r.demo ? '' : ` · ${(source.durationMs / 1000).toFixed(1)} s`}</span>`).join('')}</div><div class="quiet-notice">${r.identity.method === 'calculated' ? 'CUIL calculado a partir del DNI y del prefijo confirmado por el operador. ' : ''}La coincidencia numérica no verifica la identidad. La información puede tener rezago y debe contrastarse con el titular.</div><div class="report-actions"><button type="button" id="copy-report" class="button secondary">Copiar resumen</button><button type="button" id="print-report" class="button secondary">Imprimir informe</button><button type="button" id="go-products" class="button primary">Comparar líneas prendarias →</button></div><p class="report-footnote">Fuente: ${r.demo ? 'datos de ejemplo, sin consulta externa' : 'Central de Deudores del Banco Central de la República Argentina'}. El informe no incluye Veraz/Nosis, ingresos ni una aprobación de crédito. Se elimina de esta pantalla al limpiar o cerrar la página.</p>`;
  // Use SVG height attributes: compatible with a strict style-src CSP (no inline styles).
  for (const node of $('report').querySelectorAll('[data-bar-height]')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '24'); svg.setAttribute('height', '90'); svg.setAttribute('viewBox', '0 0 24 90'); svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS(svg.namespaceURI, 'rect'); const height = Number(node.dataset.barHeight); rect.setAttribute('x', '0'); rect.setAttribute('y', String(90 - height)); rect.setAttribute('width', '24'); rect.setAttribute('height', String(height)); rect.setAttribute('rx', '4'); rect.setAttribute('fill', node.dataset.current === 'true' ? '#5478dc' : '#aec0f7'); svg.append(rect); node.append(svg);
  }
  $('copy-report').addEventListener('click', async () => { try { await navigator.clipboard.writeText(reportText(r)); toast('Resumen copiado con el documento enmascarado.'); } catch { toast('No se pudo copiar. Podés usar Imprimir informe.'); } });
  $('print-report').addEventListener('click', () => window.print());
  $('go-products').addEventListener('click', () => { setTab('products'); $('tab-products').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}
function historySection(history) {
  if (history.status === 'unavailable') return `<section class="card report-section"><h3>Historial no disponible</h3><p class="muted small">${escape(history.message)}</p></section>`;
  if (history.status === 'no_records' || !history.periods.length) return '<section class="card report-section"><h3>Historial</h3><p class="muted small">La fuente no devolvió períodos históricos para esta consulta.</p></section>';
  const periods = history.periods; const bars = [...periods].reverse(); const max = Math.max(1, ...periods.map(p => p.total ?? 0));
  return `<section class="card report-section"><h3>Evolución de la deuda informada</h3><p class="help">${periods.length} períodos disponibles · Los meses ausentes no se completan con cero.</p><div class="history-chart" role="img" aria-label="Evolución del monto informado por período. Tabla de valores disponible a continuación.">${bars.map((p, index) => `<div class="history-month" title="${escape(periodLabel(p.period))}: ${escape(money(p.total))}"><div class="history-bars" data-bar-height="${p.total === null ? 0 : Math.max(3, Math.round(p.total / max * 90))}" data-current="${index === bars.length - 1}"></div><span>${p.period.slice(4)}/${p.period.slice(2, 4)}</span></div>`).join('')}</div><details class="history-details"><summary>Ver períodos, montos y situación</summary><div class="table-wrap"><table><thead><tr><th>Período</th><th>Monto informado</th><th>Mayor situación</th></tr></thead><tbody>${periods.map(p => `<tr><td>${escape(periodLabel(p.period))}</td><td>${escape(money(p.total))}</td><td>${p.worstSituation ?? 'No informada'}</td></tr>`).join('')}</tbody></table></div></details></section>`;
}
function checksSection(checks) {
  if (checks.status === 'unavailable') return `<section class="card report-section"><h3>Cheques: consulta no disponible</h3><p class="muted small">${escape(checks.message)}</p></section>`;
  if (checks.status !== 'found' || !checks.count) return '';
  return `<section class="card report-section"><h3>Cheques rechazados · ${escape(money(checks.total))} informados</h3><div class="table-wrap"><table><thead><tr><th>Fecha / causal</th><th>Regularización</th><th class="align-right">Monto</th></tr></thead><tbody>${checks.checks.map(c => `<tr><td>${escape(dateLabel(c.date))}<small>${escape(c.cause)}${c.flags.length ? ' · ' + c.flags.map(f => escape(flagLabels[f])).join(' · ') : ''}</small></td><td>${c.paidDate ? `Pago informado ${escape(dateLabel(c.paidDate))}` : 'Sin fecha de pago'}${c.fineStatus ? `<small>Multa: ${escape(c.fineStatus)}</small>` : ''}</td><td class="align-right">${escape(money(c.amount))}</td></tr>`).join('')}</tbody></table></div><p class="help">Los importes de cheques vienen expresados en pesos. El total incluye registros con y sin fecha de pago.</p></section>`;
}
function reportText(r) {
  const summary = reportSummary(r); const latest = r.sources.current.periods?.[0];
  return [r.demo ? 'TEILEN · EJEMPLO FICTICIO' : 'TEILEN · INFORME BCRA', `CUIT/CUIL: ${maskedCuit(r.cuit)}`, `Consultado: ${dateTime(r.consultedAt)}`, summary.title, summary.text, `Período: ${periodLabel(latest?.period)}`, `Monto informado: ${money(latest?.total)}`, ...Object.entries(r.sources).map(([key, value]) => `${{current:'Deudas',history:'Historial',checks:'Cheques'}[key]}: ${{found:'con información',no_records:'sin registros',unavailable:'no disponible'}[value.status]}`), 'No constituye una aprobación bancaria ni un informe Veraz. Fuente: BCRA.'].join('\n');
}

async function loadProducts() {
  if (state.loadingProducts) return;
  state.loadingProducts = true; $('reload-products').disabled = true; $('catalog-status').textContent = 'Consultando el catálogo oficial de préstamos prendarios…';
  try {
    const result = await api('/api/products'); state.products = result; const previous = $('bank-filter').value;
    const banks = [...new Map(result.products.map(p => [String(p.codigoEntidad), p.descripcionEntidad])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    $('bank-filter').innerHTML = '<option value="partners">Bancos de Teilen (4)</option><option value="">Todas las entidades</option>' + banks.map(([code, name]) => `<option value="${escape(code)}">${escape(name)}</option>`).join('');
    if (previous === 'partners' || previous === '' || banks.some(([code]) => code === previous)) $('bank-filter').value = previous;
    $('catalog-status').textContent = `${result.products.length} líneas publicadas · ${banks.length} entidades · Datos descargados ${dateTime(result.fetchedAt)}${result.cached ? ' · Caché de hasta 15 minutos' : ''}. Cada línea tiene su propia fecha de información.`;
    $('compare-error').hidden = true; renderCoverage(); runComparison();
  } catch (error) {
    $('catalog-status').textContent = 'Catálogo no disponible en este intento.';
    $('compare-error').textContent = error.message + (state.products ? ` Se conserva el catálogo descargado ${dateTime(state.products.fetchedAt)}; no está actualizado.` : ' Podés reintentar.'); $('compare-error').hidden = false;
    if (!state.products) { $('product-results').innerHTML = '<div class="card empty-products"><strong>No se recibieron condiciones del BCRA.</strong>No se mostrarán tasas ni ofertas de ejemplo como si fueran reales.</div>'; renderCoverage(); }
  } finally { state.loadingProducts = false; $('reload-products').disabled = false; }
}
function renderCoverage() {
  for (const partner of [true, false]) {
    $(partner ? 'partner-coverage' : 'bank-coverage').innerHTML = bankTargets.filter(b => !!b.partner === partner).map(bank => {
      const matches = state.products?.products.filter(p => bank.matches.some(term => normalize(p.descripcionEntidad).includes(term))) || [];
      return `<div class="bank-chip ${matches.length ? 'found' : ''}"><strong>${escape(bank.name)}${bank.platform ? ` · ${escape(bank.platform)}` : ''}</strong><span>${!state.products ? 'Catálogo sin verificar' : matches.length ? `${matches.length} líneas en el catálogo general` : 'Sin líneas en el catálogo consultado'}</span>${partner ? '<small>Aprobación: integración pendiente</small>' : ''}</div>`;
    }).join('');
  }
}
function currentQuery() { return { principal: $('principal').value, vehicleValue: $('vehicle-value').value, months: $('months').value, condition: $('condition').value, bank: $('bank-filter').value, includeOld: $('include-old').checked, includeOutside: $('include-outside').checked }; }
function runComparison() {
  if (!state.products) { if (!state.loadingProducts) loadProducts(); return; }
  try {
    state.query = currentQuery(); state.rows = compareProducts(state.products.products, state.query); state.shown = 12;
    $('compare-error').hidden = true; renderProducts();
  } catch (error) {
    state.rows = []; state.query = null; $('product-results').replaceChildren(); $('csv-export').hidden = true; $('results-count').textContent = 'Revisá los datos de la comparación'; $('compare-error').textContent = error.message; $('compare-error').hidden = false;
  }
}
$('compare-form').addEventListener('submit', event => { event.preventDefault(); runComparison(); });
for (const name of ['bank-filter', 'include-old', 'include-outside']) $(name).addEventListener('change', runComparison);
for (const name of ['principal', 'vehicle-value', 'months', 'condition']) $(name).addEventListener('input', () => { $('csv-export').hidden = true; $('results-count').textContent = 'Parámetros modificados · presioná Comparar'; $('product-results').replaceChildren(); state.rows = []; });
$('reload-products').addEventListener('click', loadProducts);
function renderProducts() {
  $('results-count').textContent = `${state.rows.length} líneas para revisar · ordenadas por CFT máximo publicado`;
  $('csv-export').hidden = !state.rows.length;
  if (!state.rows.length) { $('product-results').innerHTML = '<div class="card empty-products"><strong>No hay líneas con estos filtros.</strong>Probá otro monto, plazo o entidad. También podés incluir publicaciones antiguas o líneas fuera del monto y plazo solicitados.</div>'; return; }
  $('product-results').innerHTML = state.rows.slice(0, state.shown).map(row => {
    const p = row.product;
    return `<article class="card product-card"><div class="product-bank">${escape(p.descripcionEntidad)}</div><h3 class="product-title">${escape(p.nombreCorto || p.nombreCompleto || 'Préstamo prendario')}</h3><p class="product-segment">${escape(p.beneficiario || 'Beneficiario sin informar')}</p><div class="product-labels">${pill(row.compatible ? row.completeLimits ? 'Parámetros compatibles' : 'Límites a confirmar' : 'Fuera de parámetros', row.compatible && row.completeLimits ? 'blue' : 'amber')}${row.old ? pill('Fecha antigua o no verificable', 'amber') : ''}${pill('Simulación')}</div><div class="product-payment"><span>Cuota base estimada · ${escape(state.query.months)} meses</span><strong>${escape(money(row.payment))}</strong><small>Sin seguros, impuestos ni cargos adicionales.</small></div><div class="product-values"><div><span>CFT efectivo anual máx.</span><strong>${escape(percent(row.cft))}</strong></div><div><span>TEA máxima</span><strong>${escape(percent(numeric(p.tasaEfectivaAnualMaxima)))}</strong></div><div><span>Financia hasta</span><strong>${p.relacionMontoTasacion > 0 ? percent(p.relacionMontoTasacion) + ' del vehículo' : 'No informado'}</strong></div><div><span>Total base estimado</span><strong>${escape(money(row.baseTotal))}</strong></div></div>${row.reasons.length || row.unknowns.length ? `<p class="requirements">${[...row.reasons, ...row.unknowns].map(escape).join(' · ')}</p>` : ''}<p class="product-date">Información de la entidad: ${escape(dateLabel(p.fechaInformacion))}<br>No constituye una oferta ni una aprobación para el titular.</p><details><summary>Requisitos y condiciones publicadas</summary><p><strong>Destino:</strong> ${escape(p.destinoFondos || 'No informado')}</p><p><strong>Beneficiarios:</strong> ${escape(p.beneficiario || 'No informado')}</p><p><strong>Territorio:</strong> ${escape(p.territorioValidez || 'No informado')}</p><p><strong>Monto:</strong> ${p.montoMinimoOtorgable > 0 ? escape(money(p.montoMinimoOtorgable)) : 'Mínimo sin informar'} a ${p.montoMaximoOtorgable > 0 ? escape(money(p.montoMaximoOtorgable)) : 'máximo sin informar'} · <strong>Plazo máximo:</strong> ${p.plazoMaximoOtorgable > 0 ? p.plazoMaximoOtorgable + ' meses' : 'no informado'}</p><p><strong>Ingreso mínimo publicado:</strong> ${p.ingresoMinimoMensual > 0 ? escape(money(p.ingresoMinimoMensual)) : 'No informado'} · <strong>Cuota/ingreso:</strong> ${p.relacionCuotaIngreso > 0 ? escape(percent(p.relacionCuotaIngreso)) : 'No informada'}</p><p><strong>Edad máxima:</strong> ${p.edadMaximaSolicitada > 0 ? p.edadMaximaSolicitada + ' años' : 'No informada'} · <strong>Antigüedad laboral:</strong> ${p.antiguedadLaboralMinimaMeses > 0 ? p.antiguedadLaboralMinimaMeses + ' meses' : 'No informada'}</p><p>${escape(p.masInformacion || 'Sin observaciones adicionales publicadas.')}</p><p>La compatibilidad solo revisa monto, plazo y porcentaje financiable. Faltan verificar ingresos, edad, región, marca, antigüedad del vehículo, relación con el banco y evaluación crediticia. Una fecha reciente no garantiza vigencia comercial.</p></details></article>`;
  }).join('') + (state.shown < state.rows.length ? '<button id="show-more" type="button" class="button secondary show-more">Mostrar más líneas</button>' : '');
  $('show-more')?.addEventListener('click', () => { state.shown += 12; renderProducts(); });
}
$('csv-export').addEventListener('click', () => {
  if (!state.rows.length || !state.query) return;
  const rows = [['TEILEN - SIMULACIONES ORIENTATIVAS. No son aprobaciones ni ofertas vinculantes.'], ['Fuente BCRA', 'Descarga del catálogo', state.products.fetchedAt], ['Monto solicitado', state.query.principal, 'Valor vehículo', state.query.vehicleValue, 'Meses', state.query.months], ['Cuota y total base sin seguros, impuestos ni cargos. CFT máximo publicado, no personalizado.'], ['Entidad', 'Producto', 'Fecha información', 'CFT efectivo anual máximo %', 'TEA máxima %', 'Cuota base ARS', 'Total base ARS', 'Compatibilidad de parámetros', 'Requisitos publicados'], ...state.rows.map(r => [r.product.descripcionEntidad, r.product.nombreCompleto, r.product.fechaInformacion, r.cft, r.product.tasaEfectivaAnualMaxima, r.payment === null ? 'No informada' : r.payment.toFixed(2), r.baseTotal === null ? 'No informado' : r.baseTotal.toFixed(2), r.compatible ? 'Requiere confirmar requisitos' : r.reasons.join('. '), r.product.masInformacion])];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'teilen-comparacion-orientativa.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
renderCoverage(); updateIdentity(); loadAccess();
