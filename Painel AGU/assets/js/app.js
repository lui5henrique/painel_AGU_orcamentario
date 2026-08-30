/* =====================================================================
   app.js — estado, filtros, gráficos, tabela e inicialização do painel.
   Porta a lógica original do protótipo (Dashboard_PowerBI/painel_AGU_
   temporario.md) quase sem alterações — só a origem dos dados mudou
   (agora vem de localStorage / data/data.json / import, não mais de um
   window.__AGU_DATA__ embutido no HTML).
   Carregar por último, depois de utils.js, storage.js e importer.js.
===================================================================== */
(function(){
'use strict';

/* =====================================================================
   0. ESTADO
===================================================================== */
let contratos = [];
let empenhos  = [];
let ob        = [];

const PALETTE = ['#0B3E6F','#1472B8','#57B8FF','#2E9E3F','#8FD14F','#FFD400','#E8A400'];
const FILTER_KEYS = ['contrato','empenho','fornecedor','uf','categoria','mesIni','mesFim'];

const state = {
  filters: { contrato:'', empenho:'', fornecedor:'', uf:'', categoria:'', mesIni:'', mesFim:'' },
  tableFilters: { categoria:'', status:'' },
  activeTab: 'contratos',
  search: '',
  page: 1,
  pageSize: 12,
};

let charts = { fornecedorMes:null, estado:null, categoria:null };
let instrToUf = new Map(), instrToCategoria = new Map(), fornecedorNomeMap = new Map();
let combos = {}; // key -> { root, input, clearBtn, menu, options:[] }

/* =====================================================================
   1. PÓS-PROCESSAMENTO (mapas de apoio, vigência calculada ao vivo)
===================================================================== */
function normalizeFornecedorNome(nome, cnpjStr){
  // A "conta vinculada" do Banco do Brasil (usada em pagamentos de mão de obra
  // terceirizada) aparece na base com CNPJ genérico "191" — exibimos com um nome
  // que deixa claro que não é o fornecedor final. Vale para toda atualização de base.
  if(typeof nome === 'string' && nome.toUpperCase().includes('BANCO DO BRASIL')){
    const digits = String(cnpjStr||'').replace(/\D/g,'').replace(/^0+/,'');
    if(digits === '191') return 'BB - Conta Vinculada';
  }
  return nome;
}

function rebuildDerivedData(){
  ob.forEach(o => { o.fornecedor = normalizeFornecedorNome(o.fornecedor, o.cnpj); });

  instrToUf = new Map(contratos.map(c => [c.instrumento, c.uf || 'Não identificado']));
  instrToCategoria = new Map(contratos.map(c => [c.instrumento, c.categoria || 'Não identificado']));

  fornecedorNomeMap = new Map();
  empenhos.forEach(e => { const k = fornecedorKey(e.cnpj, e.fornecedor); if(k && !fornecedorNomeMap.has(k)) fornecedorNomeMap.set(k, e.fornecedor); });
  contratos.forEach(c => { const k = fornecedorKey(c.cnpj, c.fornecedor); if(k) fornecedorNomeMap.set(k, c.fornecedor); });
  ob.forEach(o => { const k = fornecedorKey(o.cnpj, o.fornecedor); if(k) fornecedorNomeMap.set(k, o.fornecedor); });

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  contratos.forEach(c => {
    if(c.vigenciaFim){
      const fim = new Date(c.vigenciaFim + 'T00:00:00');
      c.diasParaVencer = Math.round((fim - hoje) / 86400000);
      c.statusVigencia = c.diasParaVencer >= 0 ? 'Vigente' : 'Vencido';
    } else {
      c.diasParaVencer = null; c.statusVigencia = 'Desconhecido';
    }
    // "situacao" é um dado cadastral explícito (Ativo/Rescindido) e tem prioridade
    // sobre o cálculo por data: um contrato rescindido nunca conta como Vigente,
    // mesmo que a vigência formal ainda não tenha terminado. Hoje a base importada
    // sempre traz "Ativo" (não existe essa coluna no pipeline — ver README), então
    // este ramo fica inativo até existir uma fonte real dessa informação.
    if((c.situacao || '').trim().toLowerCase() === 'rescindido'){
      c.statusVigencia = 'Rescindido';
    }
  });

  const empInstrMap = new Map(empenhos.map(e => [e.empenho, e.instrumento]));
  ob.forEach(o => {
    if(!o.instrumento) o.instrumento = empInstrMap.get(o.empenho) || null;
    if(!o.uf) o.uf = instrToUf.get(o.instrumento) || 'Não identificado';
    if(!o.categoria) o.categoria = instrToCategoria.get(o.instrumento) || 'Não identificado';
  });

  const instrumentoSet = new Set(contratos.map(c => c.instrumento));
  empenhos.forEach(e => { e.temContrato = instrumentoSet.has(e.instrumento); });
}

/* =====================================================================
   2. FILTROS (eliminatórios — cada segmentação restringe as demais)
===================================================================== */
function applyFiltersWith(f){
  const filteredContratos = contratos.filter(c => {
    if(f.contrato && c.instrumento !== f.contrato) return false;
    if(f.uf && c.uf !== f.uf) return false;
    if(f.categoria && c.categoria !== f.categoria) return false;
    if(f.fornecedor && fornecedorKey(c.cnpj, c.fornecedor) !== f.fornecedor) return false;
    return true;
  });

  const filteredEmpenhos = empenhos.filter(e => {
    if(f.contrato && e.instrumento !== f.contrato) return false;
    if(f.empenho && e.empenho !== f.empenho) return false;
    if(f.fornecedor && fornecedorKey(e.cnpj, e.fornecedor) !== f.fornecedor) return false;
    if(f.uf && (instrToUf.get(e.instrumento) || 'Não identificado') !== f.uf) return false;
    if(f.categoria && (instrToCategoria.get(e.instrumento) || 'Não identificado') !== f.categoria) return false;
    return true;
  });

  const filteredOb = ob.filter(o => {
    if(f.contrato && o.instrumento !== f.contrato) return false;
    if(f.empenho && o.empenho !== f.empenho) return false;
    if(f.fornecedor && fornecedorKey(o.cnpj, o.fornecedor) !== f.fornecedor) return false;
    if(f.uf && o.uf !== f.uf) return false;
    if(f.categoria && o.categoria !== f.categoria) return false;
    if(f.mesIni && o.mesEmissao < f.mesIni) return false;
    if(f.mesFim && o.mesEmissao > f.mesFim) return false;
    return true;
  });

  return { filteredContratos, filteredEmpenhos, filteredOb };
}
function applyFilters(){ return applyFiltersWith(state.filters); }

/* =====================================================================
   3. COMBOBOX DE BUSCA (segmentações eliminatórias)
===================================================================== */
function computeOptionsFor(key){
  const base = Object.assign({}, state.filters);
  if(key === 'mesIni' || key === 'mesFim'){ base.mesIni = ''; base.mesFim = ''; }
  else { base[key] = ''; }
  const { filteredContratos, filteredEmpenhos, filteredOb } = applyFiltersWith(base);

  if(key === 'contrato'){
    const seen = new Map();
    filteredContratos.forEach(c => { if(!seen.has(c.instrumento)) seen.set(c.instrumento, c); });
    return [...seen.values()]
      .sort((a,b) => (a.fornecedor||'').localeCompare(b.fornecedor||''))
      .map(c => ({ value:c.instrumento, label: c.instrumento + ' — ' + shorten(c.fornecedor,26) }));
  }
  if(key === 'empenho'){
    return filteredEmpenhos.slice()
      .sort((a,b) => b.empenho.localeCompare(a.empenho))
      .map(e => ({ value:e.empenho, label: e.empenho + ' — ' + shorten(e.fornecedor,24) }));
  }
  if(key === 'fornecedor'){
    const keys = new Map();
    filteredContratos.forEach(c => { const k=fornecedorKey(c.cnpj,c.fornecedor); if(k && !keys.has(k)) keys.set(k, fornecedorNomeMap.get(k)||c.fornecedor); });
    filteredEmpenhos.forEach(e => { const k=fornecedorKey(e.cnpj,e.fornecedor); if(k && !keys.has(k)) keys.set(k, fornecedorNomeMap.get(k)||e.fornecedor); });
    filteredOb.forEach(o => { const k=fornecedorKey(o.cnpj,o.fornecedor); if(k && !keys.has(k)) keys.set(k, fornecedorNomeMap.get(k)||o.fornecedor); });
    return [...keys.entries()]
      .map(([k,label]) => ({ value:k, label: shorten(label,34) }))
      .sort((a,b) => a.label.localeCompare(b.label));
  }
  if(key === 'uf'){
    return [...new Set(filteredContratos.map(c => c.uf || 'Não identificado'))].sort().map(u => ({value:u, label:u}));
  }
  if(key === 'categoria'){
    return [...new Set(filteredContratos.map(c => c.categoria).filter(Boolean))].sort().map(c => ({value:c, label:c}));
  }
  if(key === 'mesIni' || key === 'mesFim'){
    let meses = [...new Set(filteredOb.map(o => o.mesEmissao).filter(Boolean))].sort();
    if(key === 'mesIni' && state.filters.mesFim) meses = meses.filter(m => m <= state.filters.mesFim);
    if(key === 'mesFim' && state.filters.mesIni) meses = meses.filter(m => m >= state.filters.mesIni);
    return meses.map(m => ({ value:m, label: formatMesLabel(m) }));
  }
  return [];
}

function syncComboDisplay(key){
  const combo = combos[key];
  const val = state.filters[key];
  if(val){
    const opt = combo.options.find(o => o.value === val);
    combo.input.value = opt ? opt.label : val;
    combo.root.classList.add('has-value');
  } else {
    combo.input.value = '';
    combo.root.classList.remove('has-value');
  }
}

function populateFilterOptions(){
  FILTER_KEYS.forEach(key => {
    const opts = computeOptionsFor(key);
    combos[key].options = opts;
    if(state.filters[key] && !opts.some(o => o.value === state.filters[key])){
      state.filters[key] = ''; // a combinacao atual deixou de existir com os outros filtros ativos
    }
    syncComboDisplay(key);
  });
}

function renderComboMenu(key, query){
  const combo = combos[key];
  const norm = normalizeText(query);
  const filtered = norm ? combo.options.filter(o => normalizeText(o.label).includes(norm)) : combo.options;
  const shown = filtered.slice(0, 150);
  combo._shown = shown;

  if(shown.length === 0){
    combo.menu.innerHTML = '<div class="ss-empty">Nenhum resultado</div>';
  } else {
    combo.menu.innerHTML = shown.map((o,i) =>
      `<div class="ss-item" data-idx="${i}">${escapeHtml(o.label)}</div>`
    ).join('') + (filtered.length > shown.length
      ? `<div class="ss-empty">+ ${fmtInt.format(filtered.length - shown.length)} resultado(s) — digite para refinar</div>`
      : '');
    $$('#' + combo.root.id + ' .ss-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt(el.dataset.idx, 10);
        selectComboValue(key, shown[idx].value, shown[idx].label);
      });
    });
  }
  combo.menu.classList.add('open');
}
function closeComboMenu(key){ combos[key].menu.classList.remove('open'); }

function selectComboValue(key, value, label){
  state.filters[key] = value;
  const combo = combos[key];
  combo.input.value = label || '';
  combo.root.classList.toggle('has-value', !!value);
  closeComboMenu(key);
  combo.input.blur();
  state.page = 1;
  populateFilterOptions();
  renderAll();
}

function initSearchSelect(key){
  const idMap = { contrato:'ssContrato', empenho:'ssEmpenho', fornecedor:'ssFornecedor', uf:'ssUf', categoria:'ssCategoria', mesIni:'ssMesIni', mesFim:'ssMesFim' };
  const root = document.getElementById(idMap[key]);
  const input = root.querySelector('.ss-input');
  const clearBtn = root.querySelector('.ss-clear');
  const menu = root.querySelector('.ss-menu');
  combos[key] = { root, input, clearBtn, menu, options: [] };

  input.addEventListener('input', () => renderComboMenu(key, input.value));
  input.addEventListener('focus', () => renderComboMenu(key, state.filters[key] ? '' : input.value));
  input.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){ closeComboMenu(key); input.blur(); }
    if(e.key === 'Enter'){
      e.preventDefault();
      const shown = combo_shownSafe(key);
      if(shown && shown.length === 1) selectComboValue(key, shown[0].value, shown[0].label);
    }
  });
  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); selectComboValue(key, '', ''); });
  document.addEventListener('click', (e) => { if(!root.contains(e.target)) closeComboMenu(key); });
}
function combo_shownSafe(key){ return combos[key]._shown; }

function wireAllSearchSelects(){
  FILTER_KEYS.forEach(initSearchSelect);
}

/* =====================================================================
   4. KPIs
===================================================================== */
function updateKPIs({filteredContratos, filteredEmpenhos, filteredOb}){
  const totalEmpenhado = sumBy(filteredEmpenhos, 'valorEmpenhado');
  const totalPagoEmpenhos = sumBy(filteredEmpenhos, 'valorPago');
  const totalPagoOB = sumBy(filteredOb, 'valor');
  const pctExec = totalEmpenhado > 0 ? totalPagoEmpenhos / totalEmpenhado : NaN;
  const vigentes = filteredContratos.filter(c => c.statusVigencia === 'Vigente').length;
  const vencendo90 = filteredContratos.filter(c => c.statusVigencia === 'Vigente' && c.diasParaVencer!=null && c.diasParaVencer<=90).length;

  $('#kpiEmpenhado').textContent = formatCompactBRL(totalEmpenhado);
  $('#kpiEmpenhado').title = fmtBRLFull.format(totalEmpenhado);
  $('#kpiEmpenhadoSub').textContent = fmtInt.format(filteredEmpenhos.length) + ' empenho(s) · histórico completo';

  $('#kpiPago').textContent = formatCompactBRL(totalPagoOB);
  $('#kpiPago').title = fmtBRLFull.format(totalPagoOB);
  const mesesOb = filteredOb.map(o => o.mesEmissao).filter(Boolean).sort();
  const periodoTxt = mesesOb.length ? `${formatMesLabel(mesesOb[0])}–${formatMesLabel(mesesOb[mesesOb.length-1])}` : 'sem pagamentos no filtro';
  $('#kpiPagoSub').textContent = fmtInt.format(filteredOb.length) + ' pagamento(s) · ' + periodoTxt;

  $('#kpiExecucao').textContent = fmtPct(pctExec);
  $('#kpiVigentes').textContent = fmtInt.format(vigentes);
  $('#kpiVigentesSub').textContent = fmtInt.format(filteredContratos.length) + ' contrato(s) no filtro';
  $('#kpiVencendo').textContent = fmtInt.format(vencendo90);

  $('#filterResultChip').innerHTML =
    `<b>${fmtInt.format(filteredContratos.length)}</b> contratos · <b>${fmtInt.format(filteredEmpenhos.length)}</b> empenhos · <b>${fmtInt.format(filteredOb.length)}</b> pagamentos`;

  $('#footerCounts').textContent =
    `${fmtInt.format(contratos.length)} contratos · ${fmtInt.format(empenhos.length)} empenhos · ${fmtInt.format(ob.length)} pagamentos carregados no total`;

  const todosMeses = ob.map(o => o.mesEmissao).filter(Boolean).sort();
  const rangeGlobal = todosMeses.length ? `${formatMesLabel(todosMeses[0])} a ${formatMesLabel(todosMeses[todosMeses.length-1])}` : '—';
  $('#kpiFootnote').innerHTML =
    `<span class="fn-icon">i</span>"Total pago (OB)" reflete só o período coberto pela base de Ordens Bancárias carregada (<b>${rangeGlobal}</b>). ` +
    `"Total empenhado" e "% Execução" usam o histórico completo de cada empenho, incluindo exercícios anteriores — por isso os dois números não são diretamente comparáveis.`;
}

/* =====================================================================
   5. GRÁFICOS
===================================================================== */
function destroyChart(key){ if(charts[key]){ charts[key].destroy(); charts[key]=null; } }

function ensureEmptyMsgEl(canvas){
  let msg = canvas.parentElement.querySelector('.chart-empty-msg');
  if(!msg){
    msg = document.createElement('div');
    msg.className = 'chart-empty-msg';
    canvas.parentElement.appendChild(msg);
  }
  return msg;
}
function showChartEmpty(canvas, text){
  ensureEmptyMsgEl(canvas).textContent = text;
  ensureEmptyMsgEl(canvas).classList.add('show');
  canvas.style.visibility = 'hidden';
}
function hideChartEmpty(canvas){
  const msg = canvas.parentElement.querySelector('.chart-empty-msg');
  if(msg) msg.classList.remove('show');
  canvas.style.visibility = 'visible';
}

function renderChartFornecedorMes(filteredOb){
  const meses = [...new Set(filteredOb.map(o => o.mesEmissao).filter(Boolean))].sort();

  destroyChart('fornecedorMes');
  const canvasEl = $('#chartFornecedorMes');

  let k;
  if(state.filters.fornecedor){
    k = state.filters.fornecedor;
  } else {
    const presentes = new Set();
    filteredOb.forEach(o => {
      const key = fornecedorKey(o.cnpj, o.fornecedor);
      if(key) presentes.add(key);
    });
    if(presentes.size === 0){
      showChartEmpty(canvasEl, 'Nenhum pagamento (OB) encontrado para o filtro atual.');
      return;
    }
    // primeiro fornecedor em ordem alfabética crescente (pelo nome de exibição)
    k = [...presentes].sort((a,b) =>
      (fornecedorNomeMap.get(a) || a).localeCompare(fornecedorNomeMap.get(b) || b, 'pt-BR')
    )[0];
  }

  const label = shorten(fornecedorNomeMap.get(k) || k, 40);

  const byMonth = new Map(meses.map(m => [m,0]));
  filteredOb.forEach(o => {
    if(fornecedorKey(o.cnpj, o.fornecedor) === k){
      byMonth.set(o.mesEmissao, (byMonth.get(o.mesEmissao)||0) + (Number(o.valor)||0));
    }
  });

  if(meses.length === 0){
    showChartEmpty(canvasEl, 'Nenhum pagamento (OB) encontrado para este fornecedor no filtro atual.');
    return;
  }
  hideChartEmpty(canvasEl);

  const series = [{
    label: label,
    data: meses.map(m => byMonth.get(m)),
    borderColor: PALETTE[0],
    backgroundColor: PALETTE[0] + '22',
    tension: .35,
    pointRadius: 3,
    pointHoverRadius: 5,
    borderWidth: 2.5,
    fill: true,
  }];

  const ctx = canvasEl.getContext('2d');
  charts.fornecedorMes = new Chart(ctx, {
    type: 'line',
    data: { labels: meses.map(formatMesLabel), datasets: series },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label: (c) => `${c.dataset.label}: ${fmtBRLFull.format(c.parsed.y)}` } }
      },
      scales:{
        y:{ ticks:{ callback:(v) => formatCompactBRL(v) }, grid:{ color:'#EEF2F6' } },
        x:{ grid:{ display:false } }
      }
    }
  });
}

function renderChartEstado(filteredOb){
  const meses = [...new Set(filteredOb.map(o => o.mesEmissao).filter(Boolean))].sort();
  const ufs = [...new Set(filteredOb.map(o => o.uf || 'Não identificado'))];
  // ordena UFs pelo total pago (maior primeiro), mantendo "Não identificado" sempre por último
  const totalPorUf = new Map(ufs.map(u => [u, 0]));
  filteredOb.forEach(o => {
    const uf = o.uf || 'Não identificado';
    totalPorUf.set(uf, (totalPorUf.get(uf)||0) + (Number(o.valor)||0));
  });
  const ufsOrdenadas = ufs.slice().sort((a,b) => {
    if(a === 'Não identificado') return 1;
    if(b === 'Não identificado') return -1;
    return (totalPorUf.get(b)||0) - (totalPorUf.get(a)||0);
  });

  destroyChart('estado');
  const canvasEl = $('#chartEstado');
  if(meses.length === 0 || ufsOrdenadas.length === 0){
    showChartEmpty(canvasEl, 'Nenhum pagamento (OB) encontrado para o filtro atual.');
    $('#ufCoverageNote').innerHTML = '';
    return;
  }
  hideChartEmpty(canvasEl);

  const colorFor = (uf, i) => uf === 'Não identificado' ? '#C9D4DE' : (uf === 'Regional (multi-UF)' ? '#8FD14F' : PALETTE[i % PALETTE.length]);

  const datasets = ufsOrdenadas.map((uf, i) => {
    const byMonth = new Map(meses.map(m => [m,0]));
    filteredOb.forEach(o => {
      if((o.uf || 'Não identificado') === uf){
        byMonth.set(o.mesEmissao, (byMonth.get(o.mesEmissao)||0) + (Number(o.valor)||0));
      }
    });
    return {
      label: uf,
      data: meses.map(m => byMonth.get(m)),
      backgroundColor: colorFor(uf, i),
      borderRadius: 3,
      maxBarThickness: 34,
      stack: 'ufs',
    };
  });

  const ctx = canvasEl.getContext('2d');
  charts.estado = new Chart(ctx, {
    type: 'bar',
    data: { labels: meses.map(formatMesLabel), datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ position:'bottom', labels:{ boxWidth:8, boxHeight:8, usePointStyle:true, font:{size:10.5} } },
        tooltip:{
          callbacks:{
            label:(c) => `${c.dataset.label}: ${fmtBRLFull.format(c.parsed.y)}`,
            footer:(items) => {
              const total = items.reduce((s,it) => s + it.parsed.y, 0);
              return 'Total do mês: ' + fmtBRLFull.format(total);
            }
          }
        }
      },
      scales:{
        x:{ stacked:true, grid:{ display:false } },
        y:{ stacked:true, ticks:{ callback:(v) => formatCompactBRL(v) }, grid:{ color:'#EEF2F6' } }
      }
    }
  });

  const totalGeral = [...totalPorUf.values()].reduce((a,b)=>a+b,0);
  const naoId = totalPorUf.get('Não identificado') || 0;
  const pct = totalGeral>0 ? (100*naoId/totalGeral).toFixed(1) : '0';
  $('#ufCoverageNote').innerHTML = `<span><span class="legend-dot" style="background:#C9D4DE"></span>Não identificado = ${pct}% do valor filtrado (pagamento sem contrato/UF rastreável na base atual)</span>`;
}

function renderChartCategoria(filteredOb){
  const agg = new Map();
  filteredOb.forEach(o => {
    const key = o.categoria || 'Não identificado';
    agg.set(key, (agg.get(key)||0) + (Number(o.valor)||0));
  });
  const sorted = [...agg.entries()].sort((a,b) => b[1]-a[1]);
  const labels = sorted.map(s => s[0]);
  const values = sorted.map(s => s[1]);
  const colors = labels.map(l => l === 'Não identificado' ? '#C9D4DE' : '#1472B8');

  destroyChart('categoria');
  const canvasEl = $('#chartCategoria');
  if(values.length === 0){
    showChartEmpty(canvasEl, 'Nenhum pagamento (OB) encontrado para o filtro atual.');
    return;
  }
  hideChartEmpty(canvasEl);
  const ctx = canvasEl.getContext('2d');
  charts.categoria = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:values, backgroundColor:colors, borderRadius:6, maxBarThickness:26 }] },
    options:{
      indexAxis:'y',
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ label:(c) => fmtBRLFull.format(c.parsed.x) } }
      },
      scales:{
        x:{ ticks:{ callback:(v) => formatCompactBRL(v) }, grid:{ color:'#EEF2F6' } },
        y:{ grid:{ display:false }, ticks:{ font:{size:12} } }
      }
    }
  });
}

function renderCharts(filtered){
  renderChartFornecedorMes(filtered.filteredOb);
  renderChartEstado(filtered.filteredOb);
  renderChartCategoria(filtered.filteredOb);
}

/* =====================================================================
   6. TABELA DE DETALHAMENTO
===================================================================== */
const TABLE_CONFIG = {
  contratos: {
    columns:[
      {key:'instrumento', label:'Instrumento'},
      {key:'fornecedor', label:'Fornecedor', truncate:32},
      {key:'categoria', label:'Categoria'},
      {key:'uf', label:'UF'},
      {key:'vigenciaFim', label:'Vigência fim', type:'date'},
      {key:'statusVigencia', label:'Status', type:'badgeStatus'},
      {key:'valorGlobal', label:'Valor global', type:'currency'},
    ],
    sortDefault:(a,b) => (b.valorGlobal||0)-(a.valorGlobal||0),
    searchFields:['instrumento','fornecedor','categoria','subCategoria','uf','objeto'],
  },
  empenhos: {
    columns:[
      {key:'empenho', label:'Empenho'},
      {key:'instrumento', label:'Instrumento'},
      {key:'fornecedor', label:'Fornecedor', truncate:30},
      {key:'planoInterno', label:'Plano interno', truncate:26},
      {key:'valorEmpenhado', label:'Empenhado', type:'currency'},
      {key:'valorPago', label:'Pago', type:'currency'},
      {key:'saldoAPagar', label:'Saldo a pagar', type:'currency'},
    ],
    sortDefault:(a,b) => (b.valorEmpenhado||0)-(a.valorEmpenhado||0),
    searchFields:['empenho','instrumento','fornecedor','planoInterno','natureza','objeto'],
  },
  ob: {
    columns:[
      {key:'ordemPagamento', label:'Nº da OB'},
      {key:'documento', label:'Nº do DH'},
      {key:'dataPagamento', label:'Data pagamento', type:'date'},
      {key:'empenho', label:'Empenho'},
      {key:'fornecedor', label:'Fornecedor', truncate:28},
      {key:'uf', label:'UF'},
      {key:'valor', label:'Valor', type:'currency'},
      {key:'observacao', label:'Observação (OB)', type:'longtext'},
    ],
    sortDefault:(a,b) => (b.dataPagamento||'').localeCompare(a.dataPagamento||''),
    searchFields:['documento','ordemPagamento','empenho','fornecedor','uf','nup','observacao'],
  },
};

function cellHTML(row, col){
  const v = row[col.key];
  if(col.type === 'currency') return `<td class="num">${v!=null ? fmtBRLFull.format(v) : '—'}</td>`;
  if(col.type === 'date') return `<td>${fmtDateBR(v)}</td>`;
  if(col.type === 'longtext') return `<td class="wrap-cell">${v ? escapeHtml(v) : '—'}</td>`;
  if(col.type === 'badgeStatus'){
    const cls = v==='Vigente' ? 'badge-green' : (v==='Vencido' ? 'badge-red' : (v==='Rescindido' ? 'badge-purple' : 'badge-gray'));
    return `<td><span class="badge ${cls}">${v||'—'}</span></td>`;
  }
  if(col.truncate) return `<td title="${escapeHtml(v)}">${shorten(v, col.truncate)}</td>`;
  return `<td>${v!=null && v!=='' ? v : '—'}</td>`;
}

function rowMatchesSearch(row, normQuery, digitsQuery){
  for(const key in row){
    const val = row[key];
    if(val==null || typeof val === 'boolean') continue;
    const s = String(val);
    if(normalizeText(s).includes(normQuery)) return true;
    if(digitsQuery && s.replace(/\D/g,'').includes(digitsQuery)) return true;
  }
  return false;
}

function renderTable(filtered){
  const cfg = TABLE_CONFIG[state.activeTab];
  const sourceMap = { contratos:filtered.filteredContratos, empenhos:filtered.filteredEmpenhos, ob:filtered.filteredOb };
  let rows = sourceMap[state.activeTab];

  if(state.activeTab === 'contratos'){
    if(state.tableFilters.categoria) rows = rows.filter(r => r.categoria === state.tableFilters.categoria);
    if(state.tableFilters.status) rows = rows.filter(r => r.statusVigencia === state.tableFilters.status);
  }

  if(state.search.trim()){
    const q = normalizeText(state.search);
    const digitsQ = state.search.replace(/\D/g,'');
    rows = rows.filter(r => rowMatchesSearch(r, q, digitsQ));
  }

  rows = rows.slice().sort(cfg.sortDefault);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if(state.page > totalPages) state.page = totalPages;
  const startIdx = (state.page - 1) * state.pageSize;
  const pageRows = rows.slice(startIdx, startIdx + state.pageSize);

  $('#tableHead').innerHTML = '<tr>' + cfg.columns.map(c => `<th>${c.label}</th>`).join('') + '</tr>';

  if(pageRows.length === 0){
    $('#tableBody').innerHTML = `<tr><td colspan="${cfg.columns.length}"><div class="empty-state">Nenhum registro encontrado para os filtros e busca atuais.</div></td></tr>`;
  } else {
    $('#tableBody').innerHTML = pageRows.map(r => '<tr>' + cfg.columns.map(c => cellHTML(r,c)).join('') + '</tr>').join('');
  }

  $('#pgInfo').textContent = total === 0
    ? 'Nenhum registro'
    : `Mostrando ${startIdx+1}–${Math.min(startIdx+state.pageSize,total)} de ${fmtInt.format(total)}`;
  $('#pgPrev').disabled = state.page <= 1;
  $('#pgNext').disabled = state.page >= totalPages;
}

/* =====================================================================
   7. RENDER GERAL
===================================================================== */
function renderAll(){
  const filtered = applyFilters();
  updateKPIs(filtered);
  renderCharts(filtered);
  renderTable(filtered);
}

/* =====================================================================
   8. EVENTOS — TABS, BUSCA DA TABELA, PAGINACAO, LIMPAR FILTROS
===================================================================== */
function updateSubfiltersVisibility(){
  $('#contratosSubfilters').style.display = state.activeTab === 'contratos' ? 'flex' : 'none';
}

function populateTableSubfilters(){
  const cats = [...new Set(contratos.map(c => c.categoria).filter(Boolean))].sort();
  const statuses = [...new Set(contratos.map(c => c.statusVigencia).filter(Boolean))].sort();

  const catSel = $('#tfCategoria');
  const prevCat = state.tableFilters.categoria;
  catSel.innerHTML = '<option value="">Categoria: todas</option>' +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  catSel.value = cats.includes(prevCat) ? prevCat : '';
  if(!cats.includes(prevCat)) state.tableFilters.categoria = '';

  const statSel = $('#tfStatus');
  const prevStat = state.tableFilters.status;
  statSel.innerHTML = '<option value="">Status: todos</option>' +
    statuses.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  statSel.value = statuses.includes(prevStat) ? prevStat : '';
  if(!statuses.includes(prevStat)) state.tableFilters.status = '';
}

function wireGeneralEvents(){
  $('#clearFiltersBtn').addEventListener('click', () => {
    state.filters = { contrato:'', empenho:'', fornecedor:'', uf:'', categoria:'', mesIni:'', mesFim:'' };
    state.tableFilters = { categoria:'', status:'' };
    state.search = '';
    $('#tableSearch').value = '';
    state.page = 1;
    populateFilterOptions();
    populateTableSubfilters();
    renderAll();
  });

  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      state.page = 1;
      state.search = '';
      $('#tableSearch').value = '';
      updateSubfiltersVisibility();
      renderAll();
    });
  });

  $('#tfCategoria').addEventListener('change', (e) => {
    state.tableFilters.categoria = e.target.value;
    state.page = 1;
    renderAll();
  });
  $('#tfStatus').addEventListener('change', (e) => {
    state.tableFilters.status = e.target.value;
    state.page = 1;
    renderAll();
  });

  let searchTimer;
  $('#tableSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      renderAll();
    }, 180);
  });

  $('#pgPrev').addEventListener('click', () => { if(state.page>1){ state.page--; renderAll(); } });
  $('#pgNext').addEventListener('click', () => { state.page++; renderAll(); });
}

/* =====================================================================
   9. CARGA DE DADOS — localStorage (base importada) > data/data.json
      (exemplo) > estado vazio com aviso, se nada carregar.
===================================================================== */
function updateUpdatedChip(dateVal, withTime){
  const el = $('#updatedDate');
  if(!dateVal){ el.textContent = '—'; return; }
  const d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  if(isNaN(d)){ el.textContent = '—'; return; }
  el.textContent = d.toLocaleDateString('pt-BR') + (withTime ? ' às ' + d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '');
}

function showFetchFallbackBanner(){
  const el = $('#fetchFallbackBanner');
  if(el) el.classList.add('show');
}
function hideFetchFallbackBanner(){
  const el = $('#fetchFallbackBanner');
  if(el) el.classList.remove('show');
}

/** Aplica um novo conjunto de dados (de qualquer origem) e re-renderiza tudo. */
function applyDataset(newData, opts){
  opts = opts || {};
  contratos = newData.contratos || [];
  empenhos = newData.empenhos || [];
  ob = newData.ob || [];

  rebuildDerivedData();
  state.filters = { contrato:'', empenho:'', fornecedor:'', uf:'', categoria:'', mesIni:'', mesFim:'' };
  state.tableFilters = { categoria:'', status:'' };
  state.page = 1;
  populateFilterOptions();
  populateTableSubfilters();
  updateSubfiltersVisibility();
  renderAll();

  if(opts.origin === 'storage') updateUpdatedChip(newData.savedAt, true);
  else if(opts.origin === 'example') updateUpdatedChip(newData.geradoEm, false);
  else if(opts.origin === 'import') updateUpdatedChip(new Date(), true);
  else updateUpdatedChip(null, false);

  if(opts.origin !== 'empty') hideFetchFallbackBanner();
}

async function fetchExampleData(){
  const res = await fetch('./data/data.json');
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* API pública consumida por importer.js (handleFiles / botão "restaurar exemplo"). */
window.AGUApp = {
  loadData(newData){ applyDataset(newData, { origin:'import' }); },
  async reloadFromExample(){
    const json = await fetchExampleData();
    applyDataset(json, { origin:'example' });
  },
};

/* =====================================================================
   10. INIT
===================================================================== */
async function init(){
  wireAllSearchSelects();
  wireGeneralEvents();
  wireUploadEvents();

  const stored = AGUStorage.load();
  if(stored){
    applyDataset(stored, { origin:'storage' });
    return;
  }

  try{
    const json = await fetchExampleData();
    applyDataset(json, { origin:'example' });
  } catch(err){
    // Comum ao abrir o index.html direto (file://) — fetch() de arquivo local é bloqueado
    // por CORS em vários navegadores. O painel continua funcional, só sem dado nenhum até
    // a primeira importação manual. Ver README.md para como servir a pasta localmente.
    console.error('Não foi possível carregar data/data.json:', err);
    applyDataset({ contratos:[], empenhos:[], ob:[] }, { origin:'empty' });
    showFetchFallbackBanner();
  }
}

document.addEventListener('DOMContentLoaded', init);
})();
