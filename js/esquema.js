/**
 * Esquema do banco. SQLite roda dentro do navegador (sql.js/WASM) e o arquivo vive no
 * OPFS do dispositivo — RN-002: a fonte da verdade operacional é este banco local.
 *
 * Dinheiro em CENTAVOS (inteiro), sempre — RN-004. Decimal binário não representa 0,10
 * exatamente; somar milhares de lançamentos em float acumula erro que aparece como
 * "R$ 0,01 de diferença" que ninguém acha. Formatar em Real é problema da tela.
 */

export const VERSAO_ESQUEMA = 1;

export const ESQUEMA = `
PRAGMA foreign_keys = ON;

/* Campos comuns a todo registro (spec §2): id UUID, createdAt, updatedAt, deletedAt
   (soft delete) e deviceId de origem — é o que permite o merge entre dispositivos. */

CREATE TABLE IF NOT EXISTS contas (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    instituicao TEXT,
    tipo TEXT NOT NULL DEFAULT 'conta_corrente',
    cor TEXT,
    icone TEXT,
    saldo_inicial INTEGER NOT NULL DEFAULT 0,   -- centavos
    arquivada INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

CREATE TABLE IF NOT EXISTS cartoes (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    instituicao TEXT,
    bandeira TEXT,
    cor TEXT,
    limite INTEGER,                              -- centavos
    dia_fechamento INTEGER,
    dia_vencimento INTEGER,
    conta_pagamento_id TEXT REFERENCES contas(id),
    arquivado INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

CREATE TABLE IF NOT EXISTS grupos_categoria (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    cor TEXT,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

CREATE TABLE IF NOT EXISTS categorias (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    /* 'despesa' | 'receita' — dois conjuntos independentes (RN-400) */
    tipo TEXT NOT NULL DEFAULT 'despesa',
    icone TEXT,
    cor TEXT,
    grupo_id TEXT REFERENCES grupos_categoria(id),
    /* Subcategoria aponta para a mãe (RN-403). NULL = categoria de primeiro nível. */
    mae_id TEXT REFERENCES categorias(id),
    /* Categoria do sistema não pode ser excluída (RN-406) — é o destino de quem fica
       sem classificação. */
    do_sistema INTEGER NOT NULL DEFAULT 0,
    ativa INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

CREATE TABLE IF NOT EXISTS transacoes (
    id TEXT PRIMARY KEY,
    /* 'receita' | 'despesa' | 'despesa_cartao' | 'transferencia' | 'investimento' (RN-500).
       'investimento' é dinheiro que sai da conta e vira aplicação (aporte) ou volta dela
       (resgate) — move o saldo como uma transferência, mas o destino é um investimento. */
    tipo TEXT NOT NULL,
    valor INTEGER NOT NULL,                      -- centavos, sempre > 0 (exceto estorno de cartão)
    descricao TEXT,
    data TEXT NOT NULL,                          -- data real do fato (AAAA-MM-DD)

    /* Mês de competência: separado da data de propósito.
       (a) o mês da casa vai do dia 25 ao 24, então a data não determina o mês sozinha;
       (b) a fatura entra INTEIRA no mês em que é paga, mesmo com compras de meses
           anteriores — a data da compra fica aqui para conferir item a item.
       Só é recalculado quando a data muda. */
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,

    conta_id TEXT REFERENCES contas(id),
    cartao_id TEXT REFERENCES cartoes(id),
    categoria_id TEXT REFERENCES categorias(id),

    /* Transferência: debita origem, credita destino no mesmo evento (RN-504).
       Investimento usa os mesmos campos: aporte debita a origem; resgate credita o destino. */
    conta_origem_id TEXT REFERENCES contas(id),
    conta_destino_id TEXT REFERENCES contas(id),

    /* Investimento de destino/origem do aporte/resgate. */
    investimento_id TEXT REFERENCES investimentos(id),

    /* 'credito' | 'debito' | 'pix' | 'boleto' | 'dinheiro' (RN-510) */
    meio_pagamento TEXT,
    /* 'manual' | 'importado' — imutável e filtrável (RN-511) */
    origem TEXT NOT NULL DEFAULT 'manual',
    arquivo_origem TEXT,
    /* Identidade do lançamento importado, para não duplicar na reimportação. */
    impressao TEXT,

    /* 'efetivada' | 'pendente' (RN-502) */
    situacao TEXT NOT NULL DEFAULT 'efetivada',
    favorita INTEGER NOT NULL DEFAULT 0,
    /* Ainda não classificada: entra na fila de revisão. */
    revisar INTEGER NOT NULL DEFAULT 0,
    observacao TEXT,

    /* Parcelamento: N lançamentos vinculados à compra original (RN-304). */
    compra_id TEXT,
    parcela_num INTEGER,
    parcela_total INTEGER,
    /* Recorrência (RN-503) */
    recorrencia_id TEXT,

    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

/* Metas são ENVELOPES sobre o saldo, não contas (divergência do RN-686).
   Com uma conta só, guardar dinheiro não move dinheiro de lugar: ele continua no
   banco. Se debitasse, o saldo do app deixaria de bater com o extrato — e conciliar
   com o extrato é o uso principal. */
CREATE TABLE IF NOT EXISTS metas (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    alvo INTEGER NOT NULL,                       -- centavos
    cor TEXT,
    icone TEXT,
    prazo TEXT,
    arquivada INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

/* Cada aporte a uma meta: reserva sobre o saldo, sem mover dinheiro. */
CREATE TABLE IF NOT EXISTS aportes_meta (
    id TEXT PRIMARY KEY,
    meta_id TEXT NOT NULL REFERENCES metas(id),
    valor INTEGER NOT NULL,                      -- centavos (negativo = resgate)
    data TEXT NOT NULL,
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    observacao TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

/* Investimentos: patrimônio aplicado (CDB, fundo, ações, previdência...). Diferente da
   meta, que é um envelope sobre o saldo da conta: o investimento é dinheiro que saiu da
   conta e virou aplicação, com valor que muda com o tempo. Aqui é acompanhamento
   manual — a Cibele informa o valor aplicado e atualiza o valor atual quando quiser. */
CREATE TABLE IF NOT EXISTS investimentos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    instituicao TEXT,
    tipo TEXT,                                  -- CDB, Fundo, Ações, Previdência, Outro
    valor_aplicado INTEGER NOT NULL DEFAULT 0,  -- centavos
    valor_atual INTEGER,                        -- centavos; NULL = usa o aplicado
    cor TEXT,
    arquivado INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

/* Despesas fixas: o MODELO recorrente (RN-650). Cadastra uma vez e vale todo mês, a
   partir de uma competência (início) até outra opcional (fim — o financiamento acaba).
   Guarda o valor PREVISTO padrão; o valor real de cada mês, quando difere, mora em
   fixas_mes. A fixa é um PLANO: ela não é uma transação e não entra em despesasDoMes —
   quem conta no saldo é o lançamento do extrato que a pagou. Contar as duas dobraria. */
CREATE TABLE IF NOT EXISTS despesas_fixas (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    /* 'despesa' (conta a pagar) | 'receita' (entrada recorrente: salário, aluguel recebido).
       Mesmo modelo para os dois — muda só o sinal e o rótulo. */
    tipo TEXT NOT NULL DEFAULT 'despesa',
    valor_previsto INTEGER NOT NULL DEFAULT 0,  -- centavos, o esperado padrão
    dia_vencimento INTEGER,                     -- 1..31, dentro da competência
    categoria_id TEXT REFERENCES categorias(id),
    conta_id TEXT REFERENCES contas(id),        -- de onde costuma sair (opcional)
    /* Vigência em competência (ano*12+mes): vale de início até fim (fim NULL = sem prazo). */
    inicio_mes INTEGER NOT NULL,
    inicio_ano INTEGER NOT NULL,
    fim_mes INTEGER,
    fim_ano INTEGER,
    ativa INTEGER NOT NULL DEFAULT 1,
    observacao TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

/* Instância de uma fixa num mês: só existe quando há ALGO diferente do padrão — um valor
   ajustado (a luz veio R$ 312, não os R$ 270 previstos) ou um pagamento. É o modo "misto":
   o modelo vale sempre, mas cada mês pode ter seu valor e seu status. */
CREATE TABLE IF NOT EXISTS fixas_mes (
    id TEXT PRIMARY KEY,
    fixa_id TEXT NOT NULL REFERENCES despesas_fixas(id),
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    valor_ajustado INTEGER,                     -- NULL = usa valor_previsto do modelo
    /* 'previsto' | 'pago' | 'pulado' */
    status TEXT NOT NULL DEFAULT 'previsto',
    /* Pagamento conciliado: o lançamento do extrato que quitou a fixa. O valor pago vem
       dele, e a fixa não conta de novo (ele já está em despesasDoMes). */
    transacao_id TEXT REFERENCES transacoes(id),
    pago_em TEXT,
    observacao TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

/* Baixas: liga lançamentos a fixas (N×N). Uma fixa do mês pode ser quitada por vários
   lançamentos (uma conta paga em duas partes), e um lançamento pode cobrir mais de uma
   fixa. O valor pago da fixa é a soma dos lançamentos vinculados. Substitui o
   fixas_mes.transacao_id (vínculo 1-para-1), que continua só por compatibilidade. */
CREATE TABLE IF NOT EXISTS baixas (
    id TEXT PRIMARY KEY,
    fixa_mes_id TEXT NOT NULL REFERENCES fixas_mes(id),
    transacao_id TEXT NOT NULL REFERENCES transacoes(id),
    /* Fração do lançamento alocada a esta fixa. Um lançamento ligado a N fixas tem o valor
       COMPARTILHADO (dividido), não somado em cada uma — senão o mesmo dinheiro contaria N
       vezes. Recalculado a cada mudança do conjunto de vínculos do lançamento. */
    valor INTEGER,                               -- centavos
    /* 1 = a pessoa definiu a fração à mão; nesse caso a divisão automática não a sobrescreve. */
    manual INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    excluido_em TEXT,
    dispositivo TEXT
);

/* Histórico mensal informado à mão: os meses anteriores ao uso do app (ex.: Jan–Jun) que
   servem só de referência no painel. Não são lançamentos — são os totais fechados do mês,
   então não entram no saldo ao vivo (que é reconstruído dos lançamentos de verdade). */
CREATE TABLE IF NOT EXISTS historico_mensal (
    id TEXT PRIMARY KEY,
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    entradas INTEGER NOT NULL DEFAULT 0,        -- centavos
    saidas INTEGER NOT NULL DEFAULT 0,          -- centavos
    saldo INTEGER,                              -- centavos; saldo que fechou o mês
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    dispositivo TEXT
);

CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT,
    atualizado_em TEXT
);

/* Fila de alterações (outbox, RN-742): toda escrita entra aqui e o serviço de
   sincronização consome em segundo plano. A UI nunca espera rede. */
CREATE TABLE IF NOT EXISTS fila_sync (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entidade TEXT NOT NULL,
    registro_id TEXT NOT NULL,
    operacao TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    enviado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_tx_mes ON transacoes(ano, mes) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_data ON transacoes(data) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_conta ON transacoes(conta_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_cartao ON transacoes(cartao_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_cat ON transacoes(categoria_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_lixeira ON transacoes(excluido_em);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_impressao ON transacoes(impressao)
    WHERE impressao IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aporte_meta ON aportes_meta(meta_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_fixa_viva ON despesas_fixas(ativa) WHERE excluido_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fixames_unica ON fixas_mes(fixa_id, mes, ano)
    WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_fixames_tx ON fixas_mes(transacao_id) WHERE excluido_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_baixa_unica ON baixas(fixa_mes_id, transacao_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_baixa_tx ON baixas(transacao_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_baixa_fm ON baixas(fixa_mes_id) WHERE excluido_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_histmes ON historico_mensal(mes, ano);
`;
