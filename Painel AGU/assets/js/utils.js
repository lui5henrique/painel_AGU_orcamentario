/* =====================================================================
   utils.js — helpers genéricos (formatação, datas, texto).
   Script clássico (sem "type=module") de propósito: funciona também
   abrindo o index.html direto via file://, sem bloqueio de CORS.
   Carregar ANTES de storage.js / importer.js / app.js.
===================================================================== */
'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const fmtBRLFull = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const fmtInt = new Intl.NumberFormat('pt-BR');

function formatCompactBRL(v){
  if(v==null || !isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if(abs >= 1e9) return sign + 'R$ ' + (abs/1e9).toLocaleString('pt-BR',{maximumFractionDigits:2}) + ' bi';
  if(abs >= 1e6) return sign + 'R$ ' + (abs/1e6).toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' mi';
  if(abs >= 1e3) return sign + 'R$ ' + (abs/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' mil';
  return fmtBRLFull.format(v);
}
function fmtPct(v){ return isFinite(v) ? (v*100).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%' : '—'; }
function shorten(str, max){
  if(!str) return '—';
  str = String(str);
  return str.length > max ? str.slice(0,max-1).trim() + '…' : str;
}
function sumBy(arr, key){ return arr.reduce((a,r)=> a + (Number(r[key])||0), 0); }
function fornecedorKey(cnpj, nome){
  const digits = (cnpj!=null ? String(cnpj).replace(/\D/g,'') : '');
  if(digits.length >= 11) return digits;
  return (nome||'').trim().toUpperCase();
}
function formatMesLabel(m){
  if(!m) return m;
  const [y,mo] = m.split('-');
  const nomes = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return nomes[parseInt(mo,10)-1] + '/' + y;
}
function normalizeText(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function escapeHtml(s){
  return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pad2(n){ return String(n).padStart(2,'0'); }
function excelSerialOrISOToDate(v){
  if(v instanceof Date) return v;
  if(typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  if(typeof v === 'string' && v.length >= 7){
    const datePart = v.length===7 ? v+'-01' : v;
    // Se a string já tiver hora embutida (ex.: ISO completo "...T00:00:00"), não duplica o sufixo.
    return new Date(/[T ]\d{1,2}:\d{2}/.test(datePart) ? datePart : datePart + 'T00:00:00Z');
  }
  return null;
}
function dateToISODate(v){
  const d = excelSerialOrISOToDate(v);
  if(!d || isNaN(d)) return null;
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth()+1) + '-' + pad2(d.getUTCDate());
}
function dateToYYYYMM(v){
  const d = excelSerialOrISOToDate(v);
  if(!d || isNaN(d)) return null;
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth()+1);
}
function fmtDateBR(iso){
  if(!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function readNum(v){
  if(v==null || v==='') return 0;
  if(typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/^R\$\s*/,'');
  if(/,\d{1,2}$/.test(s)) s = s.replace(/\./g,'').replace(',', '.');
  else s = s.replace(/,/g,'');
  const n = Number(s);
  return isFinite(n) ? n : 0;
}
function readBool(v){
  if(v===true || v===1) return true;
  if(v==null) return false;
  const s = String(v).trim().toLowerCase();
  return s==='true' || s==='1' || s==='sim' || s==='yes';
}

/* =====================================================================
   Helpers novos, específicos do import contra o pipeline real
   (Dashboard_PowerBI/*.ipynb). A lógica de split/recalculo abaixo
   replica o que já está validado em Site/scripts/build_seed_data.py —
   ver esse arquivo para o histórico da decisão.
===================================================================== */

/** "35.230.250/0001-00 - CONSTRUTORA ENERGETTE LTDA" -> {doc, nome} */
function parseDocFornecedor(raw){
  if(!raw) return { doc:'', nome:'Não informado' };
  const s = String(raw).trim();
  const i = s.indexOf(' - ');
  if(i === -1) return { doc:'', nome:s };
  return { doc: s.slice(0,i).trim(), nome: s.slice(i+3).trim() };
}

/** CNPJ das Ordens Bancárias vem como número de planilha ('16698131000124.0',
    ou '191.0' para a conta vinculada do Banco do Brasil) — remove o ".0" final. */
function normalizeObCnpj(v){
  if(v==null || v==='') return '';
  let s = String(v).trim();
  if(s.endsWith('.0')) s = s.slice(0,-2);
  return s;
}

const UF_SET = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

/** Não existe coluna de UF no pipeline — infere a partir do texto de
    "unidade requisitante" (ex.: "BA (PU, PF e CJU...)" -> "BA"). Cobre a
    maioria dos casos observados na base real; casos multi-UF (ex.: "Região
    Nordeste (SAD5R)") ficam como "Não identificado" — ver README. */
function extractUF(unidadeStr){
  if(!unidadeStr) return 'Não identificado';
  const s = String(unidadeStr).trim();
  if(/^Regi[aã]o Nordeste/i.test(s)) return 'Não identificado';
  if(/S[aã]o Lu[ií]s/i.test(s)) return 'MA';
  let m = s.match(/^([A-Z]{2})\s*\(/);
  if(m && UF_SET.has(m[1])) return m[1];
  m = s.match(/\/([A-Z]{2})\b/);
  if(m && UF_SET.has(m[1])) return m[1];
  return 'Não identificado';
}

/** Nº de meses corridos entre início e fim de vigência, piso de 1 — mesma
    fórmula de Site/scripts/build_seed_data.py::calc_qtd_parcelas. Usada
    para recalcular o valor global do contrato (ver importer.js), porque a
    coluna "contratos_valor_global" da planilha zera quando início e fim
    caem no mesmo mês. */
function calcQtdParcelas(dtIniISO, dtFimISO){
  const a = excelSerialOrISOToDate(dtIniISO), b = excelSerialOrISOToDate(dtFimISO);
  if(!a || !b || isNaN(a) || isNaN(b)) return 0;
  const months = (b.getUTCFullYear()-a.getUTCFullYear())*12 + (b.getUTCMonth()-a.getUTCMonth());
  return Math.max(1, months);
}
