/* =====================================================================
   importer.js — importação da base a partir dos arquivos REAIS gerados
   pelo pipeline (Dashboard_PowerBI/*.ipynb), 100% no navegador (SheetJS).

   Importante: este parser NÃO espera mais o esquema "dim_contratos /
   fato_empenhos / fato_ob" do protótipo original (esse esquema nunca
   existiu no pipeline real). Ele lê as 3 abas que os notebooks já
   produzem hoje:
     - "Contratos"    (de base_contratos(tratada).xlsx)
     - "empenhos"     (de empenhos_comprasnet(tratada).xlsx)
     - "OB_semanal_5" (de ordens_bancarias(tratada).xlsx)
   A lógica de split/recalculo replica o que já está validado em
   Site/scripts/build_seed_data.py — ver esse arquivo e o README desta
   pasta para o histórico das decisões (heurística de UF, fórmula de
   valor global, ausência de "situação" do contrato).

   Carregar depois de utils.js e storage.js, antes de app.js.
===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   1. Detecção de aba (independe de em qual arquivo ela veio — assim o
      usuário pode selecionar os 3 arquivos do pipeline de uma vez, ou
      até um único workbook combinado com as 3 abas, sem código extra).
--------------------------------------------------------------------- */
function classifySheetName(name){
  const n = normalizeText(name || '');
  if(n.startsWith('contrato')) return 'contratos';
  if(n.startsWith('empenho')) return 'empenhos';
  if(n.startsWith('ob_semanal') || n.startsWith('ob semanal')) return 'ob';
  return null;
}

/* ---------------------------------------------------------------------
   2. Transformação aba -> modelo interno (mesmos nomes de campo que o
      resto do app já usa: contratos/empenhos/ob com instrumento, cnpj,
      fornecedor etc.) + contagem de avisos para o relatório pós-import.
--------------------------------------------------------------------- */
function buildContratos(rows){
  const out = [];
  let semInstrumento = 0, semUF = 0;
  rows.forEach(r => {
    const instrumento = String(r['contratos_num_instrumento']||'').trim();
    if(!instrumento){ semInstrumento++; return; }
    const unidade = r['contratos_unid_requisitantes'] || 'Não informado';
    const uf = extractUF(unidade);
    if(uf === 'Não identificado') semUF++;
    const { doc, nome } = parseDocFornecedor(r['contratos_doc_fornecedor']);
    const vigenciaInicio = dateToISODate(r['contratos_vigencia_inicio']);
    const vigenciaFim = dateToISODate(r['contratos_vigencia_fim']);
    const valorParcela = readNum(r['contratos_valor_parcela']);
    // valorGlobal é sempre recalculado (parcela x qtd. de parcelas), não lido da planilha —
    // "contratos_valor_global"/"contratos_vigencia_contrato" zeram quando início e fim caem
    // no mesmo mês. Ver utils.js::calcQtdParcelas.
    const qtdParcelas = calcQtdParcelas(vigenciaInicio, vigenciaFim);
    out.push({
      instrumento,
      idContrato: r['id_contrato'],
      categoria: r['contratos_categoria'] || 'Não informado',
      subCategoria: r['contratos_sub_categoria'] || 'Não informado',
      unidade,
      uf,
      fornecedor: nome,
      cnpj: doc,
      objeto: r['contratos_objeto'],
      vigenciaInicio,
      vigenciaFim,
      prorrogavel: readBool(r['contratos_prorrogavel']),
      valorParcela,
      valorGlobal: Math.round(valorParcela * qtdParcelas * 100) / 100,
      // Não existe coluna de "situação" (Ativo/Rescindido) no pipeline atual — fica fixo em
      // "Ativo" até existir uma fonte real. rebuildDerivedData() calcula statusVigencia pela
      // data de vigência normalmente; só deixa de recalcular se "situacao" vier "Rescindido"
      // literalmente, o que nunca acontece com este fallback (comportamento seguro).
      situacao: 'Ativo',
    });
  });
  return { records: out, warnings: { semInstrumento, semUF } };
}

function buildEmpenhos(rows){
  const out = [];
  let semNumero = 0;
  rows.forEach(r => {
    const empenho = String(r['num_empenho']||'').trim();
    if(!empenho){ semNumero++; return; }
    const { doc, nome } = parseDocFornecedor(r['favorecido']);
    const anoMatch = empenho.match(/^(\d{4})/);
    const valorEmpenhado = readNum(r['empenhado']);
    const valorPago = readNum(r['pago']);
    const valorRpInscrito = readNum(r['RP_inscrito']);
    const valorRpPago = readNum(r['RP_pago']);
    out.push({
      instrumento: String(r['num_instrumento']||'').trim(),
      empenho,
      ano: anoMatch ? anoMatch[1] : null,
      planoInterno: r['plano_interno'] || 'Não informado',
      natureza: r['natureza_despesa'] || 'Não informado',
      fornecedor: nome,
      cnpj: doc,
      objeto: r['objeto'],
      valorEmpenhado,
      valorALiquidar: readNum(r['a_liquidar']),
      valorLiquidado: readNum(r['liquidado']),
      valorPago,
      valorRpInscrito,
      valorRpALiquidar: readNum(r['RP_a_liquidar']),
      valorRpLiquidado: readNum(r['RP_liquidado']),
      valorRpPago,
      // Não existe coluna própria de "saldo a pagar" no pipeline — assunção documentada no
      // README (a validar com a área de negócio): saldo = (empenhado - pago) do exercício
      // corrente + (RP inscrito - RP pago) de restos a pagar.
      saldoAPagar: Math.round(((valorEmpenhado - valorPago) + (valorRpInscrito - valorRpPago)) * 100) / 100,
      temContrato: false, // recalculado em rebuildDerivedData() por join com a lista de contratos
    });
  });
  return { records: out, warnings: { semNumero } };
}

function buildOb(rows){
  const out = [];
  let semOrdemPagamento = 0;
  rows.forEach(r => {
    const ordemPagamento = r['ob_ordem_pagamento'];
    if(!ordemPagamento){ semOrdemPagamento++; return; }
    out.push({
      documento: r['ob_documento_habil'],
      ordemPagamento,
      empenho: String(r['ob_empenho']||'').trim(),
      instrumento: null, uf: null, categoria: null, // preenchidos por rebuildDerivedData() via join
      dataPagamento: dateToISODate(r['ob_data_pagamento']),
      mesEmissao: dateToYYYYMM(r['ob_mes_emissao']),
      fornecedor: r['ob_nome_fornecedor'] || 'Não informado',
      cnpj: normalizeObCnpj(r['ob_doc_fornecedor']),
      valor: readNum(r['ob_valor']),
      observacao: r['ob_observacao'],
      nup: r['ob_processo_NUP'],
    });
  });
  return { records: out, warnings: { semOrdemPagamento } };
}

const SHEET_BUILDERS = { contratos: buildContratos, empenhos: buildEmpenhos, ob: buildOb };
const SHEET_LABELS = {
  contratos: 'Contratos (arquivo base_contratos(tratada).xlsx, aba "Contratos")',
  empenhos: 'Empenhos (arquivo empenhos_comprasnet(tratada).xlsx, aba "empenhos")',
  ob: 'Ordens Bancárias (arquivo ordens_bancarias(tratada).xlsx, aba "OB_semanal_5")',
};

/* ---------------------------------------------------------------------
   3. Modal de upload — abrir/fechar/status (igual ao protótipo original).
--------------------------------------------------------------------- */
function openModal(){ $('#uploadModal').classList.add('open'); }
function closeModal(){
  $('#uploadModal').classList.remove('open');
  $('#uploadStatus').className = 'upload-status';
  $('#uploadStatus').innerHTML = '';
  $('#fileInput').value = '';
}
function setUploadStatus(kind, html){
  const el = $('#uploadStatus');
  el.className = 'upload-status show ' + kind;
  el.innerHTML = html;
}

/* ---------------------------------------------------------------------
   4. Processamento dos arquivos selecionados/arrastados.
      Aceita 1 a N arquivos .xlsx: o fluxo normal é os 3 arquivos do
      pipeline selecionados juntos, mas um único workbook com as 3 abas
      também funciona (cada aba é identificada pelo nome, não pelo
      arquivo de origem). Só substitui a base atual se as 3 categorias
      (contratos/empenhos/ob) forem reconhecidas — senão mostra o que
      faltou e não altera nada.
--------------------------------------------------------------------- */
async function handleFiles(fileList){
  const files = Array.from(fileList || []);
  if(!files.length) return;
  setUploadStatus('loading', 'Lendo e processando ' + files.length + ' arquivo(s)…');

  try{
    const bucket = { contratos:null, empenhos:null, ob:null };
    const foundIn = { contratos:[], empenhos:[], ob:[] };

    for(const file of files){
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:true });
      wb.SheetNames.forEach(sheetName => {
        const kind = classifySheetName(sheetName);
        if(!kind) return;
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval:null });
        foundIn[kind].push(file.name + ' → aba "' + sheetName + '"');
        bucket[kind] = SHEET_BUILDERS[kind](rows);
      });
    }

    const duplicadas = Object.entries(foundIn).filter(([,v]) => v.length > 1);
    if(duplicadas.length){
      throw new Error('Mais de um arquivo/aba do mesmo tipo foi selecionado — ' +
        duplicadas.map(([k,v]) => SHEET_LABELS[k] + ': ' + v.join(' e ')).join('; ') +
        '. Selecione um arquivo por tipo.');
    }

    const faltando = ['contratos','empenhos','ob'].filter(k => !bucket[k]);
    if(faltando.length){
      throw new Error('Não encontrei a(s) aba(s) de: ' +
        faltando.map(k => SHEET_LABELS[k]).join('; ') +
        '. A base carregada atualmente não foi alterada.');
    }

    const newData = {
      contratos: bucket.contratos.records,
      empenhos: bucket.empenhos.records,
      ob: bucket.ob.records,
    };

    // Avisos de qualidade cruzando as 3 entidades (além dos avisos já contados por aba).
    const contratoSet = new Set(newData.contratos.map(c => c.instrumento));
    const empenhoSet = new Set(newData.empenhos.map(e => e.empenho));
    const empenhosSemContrato = newData.empenhos.filter(e => e.instrumento && !contratoSet.has(e.instrumento)).length;
    const obSemEmpenho = newData.ob.filter(o => o.empenho && !empenhoSet.has(o.empenho)).length;

    const warnings = [];
    if(bucket.contratos.warnings.semInstrumento) warnings.push(fmtInt.format(bucket.contratos.warnings.semInstrumento) + ' linha(s) de contrato sem número de instrumento (ignoradas)');
    if(bucket.contratos.warnings.semUF) warnings.push(fmtInt.format(bucket.contratos.warnings.semUF) + ' contrato(s) com UF não identificável automaticamente pela unidade requisitante');
    if(bucket.empenhos.warnings.semNumero) warnings.push(fmtInt.format(bucket.empenhos.warnings.semNumero) + ' linha(s) de empenho sem número (ignoradas)');
    if(bucket.ob.warnings.semOrdemPagamento) warnings.push(fmtInt.format(bucket.ob.warnings.semOrdemPagamento) + ' linha(s) de pagamento sem número de OB (ignoradas)');
    if(empenhosSemContrato) warnings.push(fmtInt.format(empenhosSemContrato) + ' empenho(s) sem contrato correspondente na base importada');
    if(obSemEmpenho) warnings.push(fmtInt.format(obSemEmpenho) + ' pagamento(s) (OB) sem empenho correspondente na base importada — comum quando a OB paga Restos a Pagar de exercício anterior');

    AGUApp.loadData(newData);
    const saveResult = AGUStorage.save(newData);

    let msg = `<div>Base atualizada: <b>${fmtInt.format(newData.contratos.length)}</b> contratos, ` +
      `<b>${fmtInt.format(newData.empenhos.length)}</b> empenhos e <b>${fmtInt.format(newData.ob.length)}</b> pagamentos carregados.</div>`;
    if(!saveResult.ok){
      msg += '<div style="margin-top:6px;">Os dados foram aplicados na tela, mas não foi possível salvá-los para a próxima visita ' +
        '(armazenamento do navegador indisponível ou cheio) — você precisará reimportar depois de fechar a página.</div>';
    }
    if(warnings.length){
      msg += '<ul style="margin:8px 0 0;padding-left:18px;">' + warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul>';
    }
    setUploadStatus('ok', msg);
    setTimeout(closeModal, warnings.length ? 3600 : 1800);
  } catch(err){
    console.error(err);
    setUploadStatus('err', escapeHtml('Não foi possível processar os arquivos: ' + err.message));
  }
}

/* ---------------------------------------------------------------------
   5. Eventos (botão, modal, dropzone com drag&drop, input multi-arquivo).
--------------------------------------------------------------------- */
function wireUploadEvents(){
  $('#openUploadBtn').addEventListener('click', openModal);
  $('#closeUploadBtn').addEventListener('click', closeModal);
  $('#cancelUploadBtn').addEventListener('click', closeModal);
  $('#uploadModal').addEventListener('click', (e) => { if(e.target.id === 'uploadModal') closeModal(); });

  const dz = $('#dropzone');
  dz.addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => handleFiles(e.target.files));
  ['dragenter','dragover'].forEach(evt => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { if(e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

  const fallbackImportBtn = $('#fetchFallbackImportBtn');
  if(fallbackImportBtn) fallbackImportBtn.addEventListener('click', openModal);

  const resetBtn = $('#resetToExampleBtn');
  if(resetBtn){
    resetBtn.addEventListener('click', async () => {
      AGUStorage.clear();
      setUploadStatus('loading', 'Restaurando base de exemplo…');
      try{
        await AGUApp.reloadFromExample();
        setUploadStatus('ok', 'Base de exemplo restaurada. A base importada foi removida deste navegador.');
        setTimeout(closeModal, 1500);
      } catch(err){
        console.error(err);
        setUploadStatus('err', 'Não foi possível restaurar o exemplo: ' + err.message);
      }
    });
  }
}
