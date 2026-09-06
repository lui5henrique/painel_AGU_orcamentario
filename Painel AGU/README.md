<img width="1838" height="835" alt="image" src="https://github.com/user-attachments/assets/a968956a-4134-4772-aa19-0efcf47d2f25" />
# Painel AGU — Execução Orçamentária

Painel de contratos, empenhos e ordens bancárias (Superintendência Regional de Administração
da 5ª Região — SAD 5R). Site 100% estático — nenhum backend, nenhuma dependência de servidor.
A base de dados é atualizada **direto pelo navegador**, importando os arquivos `.xlsx` que o
pipeline em `Dashboard_PowerBI/` já gera, sem precisar voltar ao chat para regenerar nada.

Este painel nasceu de um protótipo feito no Claude Chat
([Dashboard_PowerBI/painel_AGU_temporario.md](../Dashboard_PowerBI/painel_AGU_temporario.md)) —
aqui ele foi reorganizado em arquivos separados e ganhou um importador que lê os arquivos reais
do pipeline (o protótipo original esperava um esquema de planilha que nunca existiu de fato).

## Como rodar

Os dados de exemplo (`data/data.json`) são carregados via `fetch`, que a maioria dos navegadores
bloqueia quando o arquivo é aberto direto (`file://`). Por isso, sirva a pasta com um servidor
local simples:

```bash
cd "Painel AGU"
python -m http.server 8080
# depois abra http://localhost:8080/
```

Alternativas: a extensão **Live Server** do VS Code, ou `npx serve`. Se você abrir o
`index.html` direto (duplo clique) mesmo assim, o painel funciona — só aparece um aviso amarelo
no topo explicando que o exemplo não carregou, com um atalho para importar sua própria base.

## Como atualizar a base de dados

Clique em **"Atualizar base"** e selecione (ou arraste) os 3 arquivos que os notebooks de
`Dashboard_PowerBI/` já geram:

| Arquivo | Aba esperada |
|---|---|
| `base_contratos(tratada).xlsx` | `Contratos` |
| `empenhos_comprasnet(tratada).xlsx` | `empenhos` |
| `ordens_bancarias(tratada).xlsx` | `OB_semanal_5` |

Pode selecionar os 3 de uma vez (ordem não importa — cada aba é reconhecida pelo nome) ou um
único workbook que já tenha as 3 abas juntas. Tudo é processado no navegador via
[SheetJS](https://sheetjs.com/) — nenhum dado sai da sua máquina. Se faltar algum arquivo/aba, o
painel mostra o que falta e **não altera** a base que já estava carregada.

Depois de importar, a base fica salva no `localStorage` do navegador (chave
`painel_agu_base_v1`) — ela persiste entre sessões, mesmo fechando e abrindo o navegador de
novo, até você importar outra base ou clicar em **"Restaurar exemplo"** (dentro do modal de
upload), que limpa a base salva e volta ao `data/data.json`.

> A base fica só no navegador de quem importou — outras pessoas abrindo o mesmo link não veem
> a atualização automaticamente; cada uma precisa importar os arquivos no seu próprio navegador.

## Estrutura

```
index.html                  shell da página (sem CSS/JS/dados inline)
assets/css/painel.css       todo o estilo
assets/js/
  utils.js                  formatação, datas, e os helpers de parsing (ver abaixo)
  storage.js                persistência em localStorage
  importer.js                leitura dos .xlsx reais (SheetJS) + validação + UI do modal
  app.js                    estado, filtros, gráficos (Chart.js), tabela, inicialização
assets/img/logo-agu.png     logo da AGU (extraído do base64 do protótipo original)
data/data.json               dataset de exemplo (snapshot de 2026-08-27)
```

## Limitações conhecidas (decisões assumidas no import)

O pipeline atual (`Dashboard_PowerBI/*.ipynb`) não traz algumas informações que o protótipo
original exibia — o importador (`assets/js/importer.js`) faz suposições documentadas para
preencher essas lacunas. Vale revisar com a área de negócio antes de confiar cegamente nelas:

- **UF do contrato**: não existe coluna de UF na planilha de contratos. O painel tenta inferir a
  partir do texto de "unidade requisitante" (`extractUF()` em `utils.js`), ex.: `"BA (PU, PF e
  CJU...)"` → `BA`. Funciona para a maioria dos casos reais, mas unidades como *"Região Nordeste
  (SAD5R)"* cobrem várias UFs ao mesmo tempo e ficam como **"Não identificado"** — não há como
  resolver isso automaticamente sem mudar a fonte de dados.
- **Situação do contrato (Ativo/Rescindido)**: não existe essa coluna no pipeline. Todo contrato
  importado entra como `"Ativo"`; o status "Vigente/Vencido" continua sendo calculado
  normalmente pela data de vigência (isso não muda), só o status **"Rescindido"** nunca aparece
  até existir uma fonte real dessa informação.
- **Valor global do contrato**: sempre recalculado como `valor da parcela × quantidade de
  parcelas` (meses entre início e fim da vigência, piso de 1), em vez de usar a coluna
  `contratos_valor_global` da planilha — essa coluna zera quando início e fim caem no mesmo mês.
  Mesma lógica já usada em `Site/scripts/build_seed_data.py`.
- **Saldo a pagar do empenho**: não existe coluna própria. É calculado como
  `(empenhado − pago) + (RP inscrito − RP pago)` — uma aproximação razoável, mas **não validada
  formalmente com a área de negócio**. Se o número não bater com o que a SAD 5R considera
  correto, é o primeiro lugar a revisar.
- **Empenhos sem contrato / OBs sem empenho correspondente**: acontece com frequência (empenhos
  de exercícios anteriores, restos a pagar) — o painel mostra a contagem no relatório pós-import
  em vez de tentar "resolver" isso, e trata como "Não identificado" nos gráficos por UF/categoria.

## Sem login (por enquanto)

Este painel não tem autenticação — qualquer pessoa com acesso à pasta/servidor vê os dados
(fornecedores, CNPJs, valores pagos). O Portal AGU em `../Site/` já tem RBAC pronto; integrar
este painel a ele é um passo futuro, deixado de fora do escopo desta versão por decisão do
usuário.
