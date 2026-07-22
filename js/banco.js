/**
 * Banco local: SQLite (sql.js/WASM) persistido no OPFS do dispositivo.
 *
 * Por que assim: RN-700 pede SQLite por dispositivo. No navegador não existe SQLite
 * nativo, então roda compilado em WebAssembly. O sql.js mantém o banco em memória e
 * exporta o arquivo inteiro — quem grava em disco somos nós, no OPFS.
 *
 * Consequência assumida: gravar é reescrever o arquivo todo. Para o volume deste app
 * (alguns milhares de lançamentos, banco na casa das centenas de KB) isso custa poucos
 * milissegundos, e é por isso que a gravação é adiada e agrupada (ver `agendarGravacao`).
 *
 * SQLCipher (RN-006) não existe aqui. Ver DECISOES.md §1.2 — lacuna assumida.
 */

import { ESQUEMA, VERSAO_ESQUEMA } from "./esquema.js";

const ARQUIVO = "financas.sqlite";
const ATRASO_GRAVACAO = 400; // ms

let SQL = null;
let db = null;
let raizOPFS = null;
let timerGravacao = null;
let gravandoAgora = Promise.resolve();
let aposGravar = null; // callback opcional após cada gravação (usado pelo backup na nuvem)

/** Registra um callback chamado depois que o banco é persistido (para o auto-backup). */
export function aoGravar(fn) {
  aposGravar = fn;
}

/* ---------------- identidade do dispositivo ---------------- */

export function idDispositivo() {
  let id = localStorage.getItem("dispositivo");
  if (!id) {
    id = uuid();
    localStorage.setItem("dispositivo", id);
  }
  return id;
}

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const agora = () => new Date().toISOString();

/* ---------------- abertura ---------------- */

async function lerArquivo() {
  try {
    raizOPFS = await navigator.storage.getDirectory();
    const h = await raizOPFS.getFileHandle(ARQUIVO, { create: false });
    const f = await h.getFile();
    return new Uint8Array(await f.arrayBuffer());
  } catch {
    return null; // primeira vez, ou navegador sem OPFS
  }
}

export async function abrir() {
  if (db) return db;
  SQL = await initSqlJs({ locateFile: (f) => `./vendor/${f}` });

  const bytes = await lerArquivo();
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run(ESQUEMA);
  migrarColunas();

  const versao = Number(config("versao_esquema") || 0);
  if (versao !== VERSAO_ESQUEMA) {
    definirConfig("versao_esquema", String(VERSAO_ESQUEMA));
  }
  if (!bytes) semear();
  else garantirCategoriasPadrao(); // banco já existente também recebe as categorias exemplo
  await gravar();
  return db;
}

/* ---------------- gravação ---------------- */

export async function gravar() {
  if (!db || !raizOPFS) return;
  gravandoAgora = (async () => {
    const dados = db.export();
    const h = await raizOPFS.getFileHandle(ARQUIVO, { create: true });
    // Escrita atômica no espírito da RN-711: o arquivo temporário só substitui o bom
    // depois de gravado inteiro. Se o navegador morrer no meio, o banco anterior
    // continua íntegro.
    const tmp = await raizOPFS.getFileHandle(`${ARQUIVO}.tmp`, { create: true });
    const w = await tmp.createWritable();
    await w.write(dados);
    await w.close();
    const lido = new Uint8Array(await (await tmp.getFile()).arrayBuffer());
    const wf = await h.createWritable();
    await wf.write(lido);
    await wf.close();
    await raizOPFS.removeEntry(`${ARQUIVO}.tmp`).catch(() => {});
    // Avisa quem quiser (o auto-backup agenda um envio à nuvem, com atraso, a partir daqui).
    if (aposGravar) { try { aposGravar(); } catch {} }
  })();
  return gravandoAgora;
}

/** Agrupa gravações: digitar num formulário não pode gravar o banco a cada tecla. */
export function agendarGravacao() {
  clearTimeout(timerGravacao);
  timerGravacao = setTimeout(() => gravar(), ATRASO_GRAVACAO);
}

export const gravacaoPendente = () => gravandoAgora;

/* ---------------- consultas ---------------- */

/** SELECT -> array de objetos. */
export function todos(sql, params = []) {
  // Sem isto, usar o banco antes de abrir estoura como "null.prepare" — que não diz
  // nada sobre a causa e custa caro de rastrear.
  if (!db) throw new Error("O banco ainda não foi aberto (chame abrir() antes).");
  const st = db.prepare(sql);
  st.bind(params);
  const linhas = [];
  while (st.step()) linhas.push(st.getAsObject());
  st.free();
  return linhas;
}

export const um = (sql, params = []) => todos(sql, params)[0] ?? null;

export function valor(sql, params = []) {
  const linha = um(sql, params);
  return linha ? Object.values(linha)[0] : null;
}

/** INSERT/UPDATE/DELETE. */
export function executar(sql, params = []) {
  db.run(sql, params);
  agendarGravacao();
}

export function transacao(fn) {
  db.run("BEGIN");
  try {
    const r = fn();
    db.run("COMMIT");
    agendarGravacao();
    return r;
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

/* ---------------- config ---------------- */

export const config = (chave) =>
  valor("SELECT valor FROM config WHERE chave = ?", [chave]);

export function definirConfig(chave, valorNovo) {
  executar(
    `INSERT INTO config (chave, valor, atualizado_em) VALUES (?,?,?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor,
                                      atualizado_em = excluded.atualizado_em`,
    [chave, valorNovo, agora()]
  );
}

/* ---------------- outbox ---------------- */

/** Toda escrita entra na fila (RN-742); o sync consome em segundo plano. */
export function enfileirar(entidade, registroId, operacao) {
  executar(
    "INSERT INTO fila_sync (entidade, registro_id, operacao, criado_em) VALUES (?,?,?,?)",
    [entidade, registroId, operacao, agora()]
  );
}

export const pendentesSync = () =>
  valor("SELECT COUNT(*) FROM fila_sync WHERE enviado_em IS NULL") ?? 0;

/* ---------------- semente ---------------- */

/* Grupos padrão (RN-410). */
const GRUPOS_PADRAO = [
  ["Essenciais", "#2a78d6"],
  ["Lifestyle", "#e87ba4"],
  ["Financeiro", "#1baf7a"],
];

/* Categorias exemplo (RN-401), com ícone e grupo. "Outros" é a do sistema (RN-406):
   recebe o que fica sem classificação e não pode ser excluída. */
const CATEGORIAS_PADRAO = [
  ["Casa", "🏠", "Essenciais"],
  ["Educação", "📚", "Essenciais"],
  ["Eletrônicos", "💻", "Lifestyle"],
  ["Lazer", "⛱️", "Lifestyle"],
  ["Restaurante", "🍽️", "Lifestyle"],
  ["Saúde", "🩺", "Essenciais"],
  ["Serviços", "🧰", "Financeiro"],
  ["Supermercado", "🛒", "Essenciais"],
  ["Transporte", "🚌", "Essenciais"],
];

/* Categorias exemplo de receita (RN-401). "Outros" de receita continua sendo a do sistema. */
const CATEGORIAS_RECEITA_PADRAO = [
  ["Salário", "💰"],
  ["Freelance", "🧾"],
  ["Rendimentos", "📈"],
  ["Reembolso", "↩️"],
  ["Presente", "🎁"],
  ["Vendas", "🏷️"],
];

function semear() {
  const t = agora();
  const disp = idDispositivo();
  GRUPOS_PADRAO.forEach(([nome, cor], i) => {
    db.run(
      `INSERT INTO grupos_categoria (id, nome, cor, ordem, criado_em, atualizado_em, dispositivo)
       VALUES (?,?,?,?,?,?,?)`,
      [uuid(), nome, cor, i, t, t, disp]
    );
  });
  db.run(
    `INSERT INTO config (chave, valor, atualizado_em) VALUES
       ('dia_virada','25',?), ('tema','escuro',?), ('ocultar_valores','0',?)`,
    [t, t, t]
  );
  garantirCategoriasPadrao();
}

/**
 * Garante grupos + categorias exemplo + "Outros" do sistema. Roda a cada abertura, então
 * vale tanto no banco novo quanto no que já existe — foi o que a Cibele pediu: as
 * categorias exemplo pré-cadastradas.
 */
export function garantirCategoriasPadrao() {
  const t = agora();
  const disp = idDispositivo();

  const grupoId = (nome) => {
    let g = valor("SELECT id FROM grupos_categoria WHERE nome = ? AND excluido_em IS NULL", [nome]);
    if (!g) {
      g = uuid();
      const ordem = GRUPOS_PADRAO.findIndex(([n]) => n === nome);
      db.run(
        `INSERT INTO grupos_categoria (id, nome, cor, ordem, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?)`,
        [g, nome, GRUPOS_PADRAO.find(([n]) => n === nome)?.[1] ?? null, ordem < 0 ? 9 : ordem, t, t, disp]
      );
    }
    return g;
  };

  const existe = (nome, tipo) =>
    valor("SELECT id FROM categorias WHERE nome = ? AND tipo = ? AND excluido_em IS NULL", [nome, tipo]);

  // "Outros" do sistema, para despesa e receita. Se um banco antigo tem "Sem categoria",
  // renomeia — é a mesma função, só muda o nome para casar com a referência.
  for (const tipo of ["despesa", "receita"]) {
    const antigo = valor(
      "SELECT id FROM categorias WHERE nome = 'Sem categoria' AND tipo = ? AND excluido_em IS NULL", [tipo]
    );
    if (antigo) {
      db.run("UPDATE categorias SET nome = 'Outros', do_sistema = 1, atualizado_em = ? WHERE id = ?", [t, antigo]);
    } else if (!existe("Outros", tipo)) {
      db.run(
        `INSERT INTO categorias (id, nome, tipo, icone, do_sistema, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,1,?,?,?)`,
        [uuid(), "Outros", tipo, "⚪", t, t, disp]
      );
    }
  }

  // As 9 categorias exemplo de despesa.
  for (const [nome, icone, grupo] of CATEGORIAS_PADRAO) {
    if (existe(nome, "despesa")) continue;
    db.run(
      `INSERT INTO categorias (id, nome, tipo, icone, grupo_id, criado_em, atualizado_em, dispositivo)
       VALUES (?,?,'despesa',?,?,?,?,?)`,
      [uuid(), nome, icone, grupoId(grupo), t, t, disp]
    );
  }

  // Categorias exemplo de RECEITA — sem elas, classificar uma entrada só oferecia "Outros".
  for (const [nome, icone] of CATEGORIAS_RECEITA_PADRAO) {
    if (existe(nome, "receita")) continue;
    db.run(
      `INSERT INTO categorias (id, nome, tipo, icone, criado_em, atualizado_em, dispositivo)
       VALUES (?,?,'receita',?,?,?,?)`,
      [uuid(), nome, icone, t, t, disp]
    );
  }

  db.run("INSERT OR REPLACE INTO config (chave, valor, atualizado_em) VALUES ('categorias_padrao','1',?)", [t]);
}

/**
 * Migrações de coluna: `CREATE TABLE IF NOT EXISTS` não altera tabela já existente, então
 * colunas novas em tabelas antigas entram por ALTER TABLE, idempotente (só se faltar).
 */
function migrarColunas() {
  const temColuna = (tabela, coluna) => {
    const st = db.prepare(`PRAGMA table_info(${tabela})`);
    let achou = false;
    while (st.step()) if (st.getAsObject().name === coluna) achou = true;
    st.free();
    return achou;
  };
  const garantir = (tabela, coluna, definicao) => {
    if (!temColuna(tabela, coluna)) db.run(`ALTER TABLE ${tabela} ADD COLUMN ${definicao}`);
  };
  // Receitas fixas: as fixas passaram a ter tipo (despesa | receita).
  garantir("despesas_fixas", "tipo", "tipo TEXT NOT NULL DEFAULT 'despesa'");
  // Tipo investimento: a transação aponta para o investimento do módulo.
  garantir("transacoes", "investimento_id", "investimento_id TEXT REFERENCES investimentos(id)");
  // Lançamento provisório (notificação antes da importação).
  garantir("transacoes", "provisorio", "provisorio INTEGER NOT NULL DEFAULT 0");

  // Vínculo 1-1 (fixas_mes.transacao_id) -> N×N (baixas): traz o que já foi baixado.
  if (config("migrou_baixas") !== "1" && temColuna("fixas_mes", "transacao_id")) {
    const t = agora();
    const disp = idDispositivo();
    const antigas = [];
    const st = db.prepare(
      "SELECT id, transacao_id FROM fixas_mes WHERE transacao_id IS NOT NULL AND excluido_em IS NULL"
    );
    while (st.step()) antigas.push(st.getAsObject());
    st.free();
    for (const r of antigas) {
      const existe = valor(
        "SELECT id FROM baixas WHERE fixa_mes_id = ? AND transacao_id = ? AND excluido_em IS NULL",
        [r.id, r.transacao_id]
      );
      if (!existe) {
        db.run(
          "INSERT INTO baixas (id, fixa_mes_id, transacao_id, criado_em, atualizado_em, dispositivo) VALUES (?,?,?,?,?,?)",
          [uuid(), r.id, r.transacao_id, t, t, disp]
        );
      }
    }
    definirConfig("migrou_baixas", "1");
  }

  // Compartilhamento de valor nas baixas: divide o lançamento entre as fixas ligadas.
  garantir("baixas", "valor", "valor INTEGER");
  garantir("baixas", "manual", "manual INTEGER NOT NULL DEFAULT 0");
  if (config("baixas_valor_migrado") !== "1") {
    db.run(
      `UPDATE baixas SET valor = (
         (SELECT t.valor FROM transacoes t WHERE t.id = baixas.transacao_id) /
         (SELECT COUNT(*) FROM baixas b2 WHERE b2.transacao_id = baixas.transacao_id AND b2.excluido_em IS NULL)
       ) WHERE excluido_em IS NULL AND valor IS NULL`
    );
    definirConfig("baixas_valor_migrado", "1");
  }
}

/* ---------------- backup / restauração ---------------- */

/** Bytes do banco inteiro — para baixar como arquivo de backup. */
export function exportarBytes() {
  if (!db) throw new Error("O banco ainda não foi aberto.");
  return db.export();
}

/**
 * Substitui o banco atual pelo de um arquivo de backup e persiste no OPFS. O esquema é
 * reaplicado por cima (CREATE IF NOT EXISTS + migrações), então um backup mais antigo
 * ganha as tabelas/colunas novas sem quebrar. Recarregar a página depois é o mais limpo.
 */
export async function importarBytes(bytes) {
  if (!SQL) SQL = await initSqlJs({ locateFile: (f) => `./vendor/${f}` });
  if (!raizOPFS) raizOPFS = await navigator.storage.getDirectory();
  let novo;
  try {
    novo = new SQL.Database(bytes);
    novo.run("SELECT 1"); // valida que é um SQLite legível
  } catch {
    throw new Error("Este arquivo não parece um backup válido.");
  }
  if (db) db.close();
  db = novo;
  db.run(ESQUEMA);
  migrarColunas();
  await gravar();
  return db;
}

export function fechar() {
  if (db) {
    db.close();
    db = null;
  }
}
