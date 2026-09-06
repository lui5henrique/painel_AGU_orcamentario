<h1 align="center">Painel AGU — Execução Orçamentária</h1>

<p align="center">Painel web de contratos, empenhos e ordens bancárias da Superintendência Regional de Administração da 5ª Região (SAD 5R)</p>

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-orange" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS3-blue" alt="CSS3">
  <img src="https://img.shields.io/badge/JavaScript-yellow" alt="JavaScript">
  <img src="https://img.shields.io/badge/Chart.js-4.4.0-informational" alt="Chart.js">
  <img src="https://img.shields.io/badge/SheetJS-0.18.5-informational" alt="SheetJS">
</p>

## Sobre o projeto

Painel de acompanhamento de contratos, empenhos e pagamentos da AGU (Advocacia-Geral da União) — Superintendência Regional de Administração da 5ª Região. É um site 100% estático, sem backend: a base de dados é carregada e atualizada direto pelo navegador, importando os arquivos `.xlsx` já tratados pelo pipeline de dados do projeto.

O painel nasceu de um protótipo e foi reorganizado em arquivos separados (HTML, CSS e JS isolados), com um importador que lê os arquivos reais gerados pelo pipeline.

## Funcionalidades

- Filtros por contrato, empenho, fornecedor, UF, categoria e período de vigência.
- KPIs e gráficos (Chart.js) de execução orçamentária por fornecedor, estado e categoria.
- Tabela de contratos/empenhos/ordens bancárias com paginação e busca.
- Importação de base de dados direto no navegador (via SheetJS), sem enviar dados para nenhum servidor.
- Persistência da base importada em `localStorage`, mantida entre sessões até uma nova importação.
- Aviso automático de fallback quando o `data.json` de exemplo não pode ser carregado (abertura via `file://`).

## Tecnologias

- HTML5 / CSS3 / JavaScript (vanilla, sem framework)
- [Chart.js](https://www.chartjs.org/) — gráficos
- [SheetJS](https://sheetjs.com/) — leitura de arquivos `.xlsx` no navegador
- `localStorage` — persistência da base importada

## Pré-requisitos

- Um navegador moderno
- Um servidor local simples para servir os arquivos (o carregamento do `data/data.json` via `fetch` é bloqueado em navegadores quando o arquivo é aberto direto com `file://`)

## Como rodar

```bash
cd "Painel AGU"
python -m http.server 8080
# depois abra http://localhost:8080/
```

Alternativas: a extensão **Live Server** do VS Code, ou `npx serve`. Se o `index.html` for aberto direto (duplo clique) mesmo assim, o painel funciona — só aparece um aviso no topo explicando que o exemplo não carregou, com um atalho para importar a base manualmente.

## Como atualizar a base de dados

Clique em **"Atualizar base"** e selecione (ou arraste) os arquivos gerados pelo pipeline de tratamento de dados:

| Arquivo | Aba esperada |
|---|---|
| `base_contratos(tratada).xlsx` | `Contratos` |
| `empenhos_comprasnet(tratada).xlsx` | `empenhos` |
| `ordens_bancarias(tratada).xlsx` | `OB_semanal_5` |

Os 3 arquivos podem ser selecionados juntos (a ordem não importa — cada aba é reconhecida pelo nome) ou como um único workbook com as 3 abas. Tudo é processado no navegador via SheetJS — nenhum dado sai da máquina de quem importa. Se faltar algum arquivo ou aba, o painel indica o que falta e não altera a base já carregada.

Depois de importar, a base fica salva no `localStorage` do navegador (chave `painel_agu_base_v1`), persistindo entre sessões até uma nova importação ou até clicar em "Restaurar exemplo" (dentro do modal de upload).

> A base fica salva apenas no navegador de quem importou — outras pessoas que abrirem o mesmo link não veem a atualização automaticamente; cada uma precisa importar os arquivos no seu próprio navegador.

## Estrutura do projeto

```
Painel AGU/
├── index.html                shell da página (sem CSS/JS/dados inline)
├── assets/
│   ├── css/painel.css        todo o estilo
│   ├── js/
│   │   ├── utils.js          formatação, datas e helpers de parsing
│   │   ├── storage.js        persistência em localStorage
│   │   ├── importer.js       leitura dos .xlsx reais (SheetJS) + validação + UI do modal
│   │   └── app.js            estado, filtros, gráficos, tabela e inicialização
│   └── img/logo-agu.png      logo da AGU
└── data/data.json            dataset de exemplo (snapshot)
```

## Limitações conhecidas

O pipeline de dados não traz algumas informações que o protótipo original exibia — o importador (`assets/js/importer.js`) faz suposições documentadas para preencher essas lacunas, que vale revisar com a área de negócio antes de confiar cegamente:

- **UF do contrato**: não existe coluna própria; é inferida a partir do texto de "unidade requisitante" (`extractUF()` em `utils.js`). Unidades que cobrem mais de uma UF ao mesmo tempo ficam como "Não identificado".
- **Situação do contrato**: não existe coluna de Ativo/Rescindido no pipeline. Todo contrato importado entra como "Ativo"; o status "Rescindido" nunca aparece até existir uma fonte real dessa informação. O status "Vigente/Vencido" continua calculado normalmente pela data de vigência.
- **Valor global do contrato**: sempre recalculado como `valor da parcela × quantidade de parcelas`, em vez de usar a coluna original da planilha (que zera quando início e fim caem no mesmo mês).
- **Saldo a pagar do empenho**: calculado como `(empenhado − pago) + (RP inscrito − RP pago)` — uma aproximação ainda não validada formalmente com a área de negócio.
- **Empenhos sem contrato / OBs sem empenho correspondente**: acontecem com frequência (empenhos de exercícios anteriores, restos a pagar). O painel mostra a contagem no relatório pós-importação e trata como "Não identificado" nos gráficos por UF/categoria, em vez de tentar resolver automaticamente.

## Segurança

O painel não tem autenticação — qualquer pessoa com acesso à pasta/servidor vê os dados (fornecedores, CNPJs, valores pagos). Integração com um sistema de autenticação/RBAC é um passo futuro, fora do escopo desta versão.

## Autor

**Luis Henrique** — [@lui5henrique](https://github.com/lui5henrique)
