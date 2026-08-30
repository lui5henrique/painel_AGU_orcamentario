/* =====================================================================
   storage.js — persistência da base importada no navegador (localStorage).
   Sem isso, a base importada some ao dar F5 (o painel voltaria sempre ao
   data/data.json de exemplo). Site continua 100% estático, sem servidor.
   Carregar depois de utils.js e antes de importer.js / app.js.
===================================================================== */
'use strict';

const AGUStorage = (function(){
  const STORAGE_KEY = 'painel_agu_base_v1';
  const SCHEMA_VERSION = 1;

  function save(payload){
    // payload = { contratos, empenhos, ob } já no formato interno (pós-transformação),
    // para não precisar reprocessar os .xlsx a cada F5.
    try{
      const record = {
        schemaVersion: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        contratos: payload.contratos,
        empenhos: payload.empenhos,
        ob: payload.ob,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      return { ok:true };
    } catch(err){
      // Ex.: QuotaExceededError, ou localStorage indisponível (navegação privada etc.)
      console.error('AGUStorage.save falhou:', err);
      return { ok:false, error:err };
    }
  }

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const record = JSON.parse(raw);
      if(!record || record.schemaVersion !== SCHEMA_VERSION) return null;
      if(!Array.isArray(record.contratos) || !Array.isArray(record.empenhos) || !Array.isArray(record.ob)) return null;
      return record;
    } catch(err){
      console.error('AGUStorage.load falhou:', err);
      return null;
    }
  }

  function clear(){
    try{ localStorage.removeItem(STORAGE_KEY); } catch(err){ console.error('AGUStorage.clear falhou:', err); }
  }

  function hasSaved(){
    try{ return localStorage.getItem(STORAGE_KEY) != null; } catch(err){ return false; }
  }

  return { save, load, clear, hasSaved };
})();
