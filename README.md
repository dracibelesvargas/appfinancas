# Finanças — controle financeiro pessoal (PWA local-first)

App de controle financeiro pessoal que roda **inteiro no navegador**, funciona **offline** e guarda os dados **no próprio dispositivo**. Sem servidor de banco, sem conta, sem enviar seus dados para lugar nenhum (a não ser que você ligue o backup na nuvem, que é opcional e seu).

- **Local-first**: o banco é um SQLite (via `sql.js`/WebAssembly) gravado no **OPFS** do navegador.
- **Offline**: um service worker guarda o código; o app abre sem internet.
- **Instalável**: dá para "Adicionar à tela inicial" no celular e usar como app.
- **Privado**: os dados vivem só no navegador daquele aparelho.

---

## Como rodar localmente

Precisa de um servidor HTTP simples (o app usa módulos ES e OPFS, que exigem `http://localhost`, não `file://`).

**Windows:** dê dois cliques em `iniciar.bat` (sobe um servidor em `http://127.0.0.1:8900/` e abre o navegador).

**Qualquer sistema:**
```bash
python -m http.server 8900 --bind 127.0.0.1
# abra http://127.0.0.1:8900/
```

> Contexto seguro obrigatório: o app só funciona em `http://localhost`/`127.0.0.1` **ou** em **HTTPS**. Pelo IP da rede (`http://192.168.x.x`) o navegador bloqueia o OPFS/service worker. Para usar no celular, publique em HTTPS (ver *Deploy* abaixo).

---

## Estrutura do projeto

```
financas-pwa/
├── index.html              # casca da página + barra de navegação
├── app.webmanifest         # manifesto PWA (nome, ícones, cores)
├── sw.js                   # service worker (offline, network-first)
├── iniciar.bat             # atalho para subir o servidor local (Windows)
├── css/
│   └── estilo.css          # estilos (tema claro/escuro)
├── icones/                 # ícones do PWA (192, 512, maskable)
├── js/
│   ├── app.js              # UI: navegação, telas, formulários
│   ├── banco.js            # abre/persiste o SQLite no OPFS; export/import; hook de backup
│   ├── esquema.js          # DDL: todas as tabelas do banco
│   ├── dominio.js          # regras de dinheiro (saldo, competência, totais)
│   ├── importar.js         # orquestra importação (fatura/extrato) + dedup
│   ├── importar-fatura.js  # leitor de fatura do C6 (PDF)
│   ├── importar-extrato.js # leitor de extrato do C6 (PDF)
│   ├── importar-ofx.js     # leitor de extrato em OFX
│   ├── migrar-historico.js # (legado) importação única do histórico da planilha
│   └── nuvem.js            # backup na nuvem via GitHub (Contents API)
├── vendor/                 # dependências vendorizadas (sem CDN): sql.js e pdf.js
└── ferramentas/
    └── gerar-historico.py  # gerou o JSON de histórico a partir do app antigo
```

> `dados/historico-2026.json` **não** está no repositório: continha lançamentos reais. O app hoje usa o *histórico manual* (**Mais → Histórico dos meses**).

---

## Banco de dados — onde fica e como acessar

O banco **não fica em servidor nenhum**. É um arquivo SQLite chamado `financas.sqlite`, mantido em memória pelo `sql.js` e persistido no **OPFS** (Origin Private File System) do navegador — isolado por origem e por dispositivo.

### Acessar / inspecionar os dados

- **Baixar o banco** (jeito recomendado): no app, **Mais → Backup e restauração → Baixar backup agora**. Você recebe um arquivo `financas-backup-AAAA-MM-DD.sqlite`, que abre em qualquer ferramenta SQLite:
  - [DB Browser for SQLite](https://sqlitebrowser.org/) (interface gráfica), ou
  - `sqlite3 financas-backup-*.sqlite` (linha de comando): `.tables`, `SELECT * FROM transacoes LIMIT 10;`
- **Restaurar** um banco: **Backup e restauração → Restaurar de um arquivo** (substitui o banco atual do navegador).
- **Programaticamente** (no console do navegador ou em código): `js/banco.js` expõe `exportarBytes()` (bytes do banco), `importarBytes(bytes)`, e helpers de consulta `todos(sql, params)`, `um(sql)`, `valor(sql)`.

### Convenções importantes do banco

- **Dinheiro em centavos** (inteiro) — nunca float. Formatar em Real é responsabilidade da tela.
- **Competência 25→24**: o "mês" vai do dia 25 ao 24 e leva o nome do mês em que fecha. Por isso cada lançamento tem `data` (fato) **e** `mes`/`ano` (competência), separados.
- **Soft delete**: registros usam `excluido_em` (a "lixeira" não entra em cálculo).

### Principais tabelas (ver `js/esquema.js` para o DDL completo)

| Tabela | O que guarda |
|---|---|
| `contas` | contas (saldo inicial, instituição) |
| `cartoes` | cartões de crédito (limite, fechamento, vencimento) |
| `grupos_categoria`, `categorias` | categorias de despesa/receita e seus grupos |
| `transacoes` | lançamentos: receita, despesa, despesa_cartao, transferencia, investimento |
| `metas`, `aportes_meta` | metas (envelopes sobre o saldo) e seus aportes |
| `investimentos` | patrimônio aplicado (aportes somam via lançamentos tipo investimento) |
| `despesas_fixas`, `fixas_mes` | contas fixas (modelo recorrente + instância por mês) |
| `baixas` | vínculo N×N entre lançamentos e fixas (com fração do valor) |
| `historico_mensal` | totais fechados dos meses de referência (Jan–Jun) |
| `config` | preferências (tema, dia de virada, flags) |

---

## Backup na nuvem (opcional, GitHub)

Em **Mais → Backup e restauração → Backup na nuvem (GitHub)**:

1. Crie um repositório **privado** (ex.: `financas-backup`).
2. Gere um **token fine-grained** com acesso só a esse repo e permissão **Contents: Read and write**.
3. Cole o token e o repositório no app.

O app passa a **enviar** uma cópia do banco automaticamente após mudanças; **restaurar** é sempre uma ação sua. O token fica só no `localStorage` do navegador — nunca vai dentro do backup.

> Nunca coloque um banco com dados reais num repositório **público**. Use um repo privado só para o backup.

---

## Deploy (GitHub Pages)

O app é 100% estático — serve em qualquer host HTTPS. Para GitHub Pages:

1. Suba estes arquivos para um repositório (o `.gitignore` já exclui os dados privados).
2. No repositório: **Settings → Pages** → *Source*: branch `main`, pasta `/ (root)` → Save.
3. Acesse a URL gerada (ex.: `https://SEU-USUARIO.github.io/appfinancas/`) e, no celular, **Adicionar à tela inicial**.

Cada aparelho tem seu próprio banco local; use o **backup na nuvem** para levar os dados entre PC e celular.

---

## Tecnologia

- **[sql.js](https://github.com/sql-js/sql.js)** — SQLite compilado para WebAssembly (vendorizado em `vendor/`).
- **[pdf.js](https://github.com/mozilla/pdf.js)** — leitura das faturas/extratos em PDF (vendorizado).
- Sem framework, sem build, sem dependências de CDN — só arquivos estáticos.
