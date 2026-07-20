/**
 * Regras do domínio. Tudo que decide dinheiro mora aqui — a tela só mostra.
 */

import { config, todos, um, valor } from "./banco.js";

export const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MESES_LONGO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/* ---------------- dinheiro (centavos) ---------------- */

/** "1.234,56" | "R$ 1.234,56" | "1234.56" | 1234.56 -> 123456 centavos. */
export function paraCentavos(entrada) {
  if (entrada === null || entrada === undefined || entrada === "") return null;
  if (typeof entrada === "number") return Math.round(entrada * 100);

  let t = String(entrada).trim().replace(/R\$/gi, "").replace(/\s| /g, "");
  const negativo = t.startsWith("-");
  t = t.replace(/^[+-]/, "");
  if (!t) return null;

  // "1.234,56" (br) x "1234.56": quem manda é a vírgula. Sem vírgula, o ponto é
  // decimal só se sobrar 1 ou 2 dígitos depois dele — senão é separador de milhar
  // ("1.234" é mil duzentos e trinta e quatro, não um e vinte e três).
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (t.includes(".")) {
    const casas = t.split(".").pop().length;
    if (casas === 3) t = t.replace(/\./g, "");
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negativo ? -1 : 1);
}

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const brl = (centavos) => fmtBRL.format((centavos ?? 0) / 100);

/** Compacto para eixo de gráfico: R$ 28,4k */
export function brlCurto(centavos) {
  const v = (centavos ?? 0) / 100;
  if (Math.abs(v) >= 1000) {
    return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  }
  return fmtBRL.format(v);
}

/* ---------------- competência: mês 25 -> 24 ---------------- */

export const diaVirada = () => Number(config("dia_virada") || 25);

/**
 * Data do calendário -> mês financeiro a que ela pertence.
 * O mês fecha no dia 24 e leva o nome do mês em que fecha: 25/06 a 24/07 = Julho.
 * É o ciclo do salário, que cai no dia 25 e banca o mês seguinte.
 * (Divergência deliberada do RN-003/RN-800 — ver DECISOES.md §2.)
 */
export function competencia(data, virada = diaVirada()) {
  const d = data instanceof Date ? data : new Date(`${data}T12:00:00`);
  const dia = d.getDate();
  let mes = d.getMonth() + 1;
  let ano = d.getFullYear();
  if (dia >= virada) {
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return { mes, ano };
}

/** Primeiro e último dia do calendário que compõem um mês financeiro. */
export function janelaDoMes(mes, ano, virada = diaVirada()) {
  const inicio = new Date(ano, mes - 2, virada, 12);
  const fim = new Date(ano, mes - 1, virada - 1, 12);
  return { inicio, fim };
}

/** Dia de vencimento -> data real dentro do mês financeiro.
 *  Vencimento no dia 28 do mês "Julho" cai em 28/06: o ciclo de julho começa em 25/06.
 *  Usar sempre o mês do nome poria o dia 28 fora do próprio ciclo a que pertence. */
export function dataVencimento(mes, ano, dia, virada = diaVirada()) {
  if (!dia || dia < 1 || dia > 31) return null;
  let mesCal = mes;
  let anoCal = ano;
  if (dia >= virada) {
    mesCal -= 1;
    if (mesCal < 1) {
      mesCal = 12;
      anoCal -= 1;
    }
  }
  const ultimo = new Date(anoCal, mesCal, 0).getDate();
  return new Date(anoCal, mesCal - 1, Math.min(dia, ultimo), 12);
}

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const dataBR = (isoStr) => {
  if (!isoStr) return "—";
  const [a, m, d] = String(isoStr).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/* ---------------- saldos ---------------- */

const VIVA = "excluido_em IS NULL"; // lixeira não entra em cálculo nenhum (RN-533)

/**
 * Saldo atual de uma conta (RN-204): saldo inicial + receitas − despesas
 * − transferências de saída + transferências de entrada, só o que está EFETIVADO.
 *
 * Despesa de cartão não entra: ela não toca a conta no lançamento, compõe a fatura
 * (RN-302). Quem debita a conta é o pagamento da fatura, que é uma transferência.
 */
export function saldoConta(contaId) {
  const inicial = valor("SELECT saldo_inicial FROM contas WHERE id = ?", [contaId]) ?? 0;
  const mov =
    valor(
      `SELECT COALESCE(SUM(
          CASE
            WHEN tipo = 'receita'  AND conta_id = :c THEN valor
            WHEN tipo = 'despesa'  AND conta_id = :c THEN -valor
            WHEN tipo IN ('transferencia','investimento') AND conta_destino_id = :c THEN valor
            WHEN tipo IN ('transferencia','investimento') AND conta_origem_id  = :c THEN -valor
            ELSE 0
          END), 0)
       FROM transacoes
       WHERE ${VIVA} AND situacao = 'efetivada'
         AND (conta_id = :c OR conta_origem_id = :c OR conta_destino_id = :c)`,
      { ":c": contaId }
    ) ?? 0;
  return inicial + mov;
}

/** Saldo previsto (RN-205): o atual mais o que está agendado até o fim do mês. */
export function saldoPrevisto(contaId, mes, ano) {
  const { fim } = janelaDoMes(mes, ano);
  const pendente =
    valor(
      `SELECT COALESCE(SUM(
          CASE
            WHEN tipo = 'receita'  AND conta_id = :c THEN valor
            WHEN tipo = 'despesa'  AND conta_id = :c THEN -valor
            WHEN tipo IN ('transferencia','investimento') AND conta_destino_id = :c THEN valor
            WHEN tipo IN ('transferencia','investimento') AND conta_origem_id  = :c THEN -valor
            ELSE 0
          END), 0)
       FROM transacoes
       WHERE ${VIVA} AND situacao = 'pendente' AND data <= :ate
         AND (conta_id = :c OR conta_origem_id = :c OR conta_destino_id = :c)`,
      { ":c": contaId, ":ate": iso(fim) }
    ) ?? 0;
  return saldoConta(contaId) + pendente;
}

/** Saldo consolidado: só contas ativas (RN-208). */
export const saldoTotal = () =>
  todos(`SELECT id FROM contas WHERE ${VIVA} AND arquivada = 0`).reduce(
    (s, c) => s + saldoConta(c.id),
    0
  );

/**
 * Saldo acumulado até o FIM de uma competência: saldo inicial + tudo que aconteceu até
 * aquele mês (inclusive). Muda de mês para mês — é o "saldo daquele mês", não o total de
 * hoje (que seria igual em qualquer mês navegado).
 */
/** Saldo de UMA conta ao fim de uma competência (25→24). É o saldo daquele mês, não o de
 *  hoje — por isso o card da conta muda quando você navega os meses. */
export function saldoContaNoMes(contaId, mes, ano) {
  const alvo = ano * 12 + mes;
  const inicial = valor("SELECT saldo_inicial FROM contas WHERE id = ?", [contaId]) ?? 0;
  const mov =
    valor(
      `SELECT COALESCE(SUM(
          CASE
            WHEN tipo = 'receita'  AND conta_id = :c THEN valor
            WHEN tipo = 'despesa'  AND conta_id = :c THEN -valor
            WHEN tipo IN ('transferencia','investimento') AND conta_destino_id = :c THEN valor
            WHEN tipo IN ('transferencia','investimento') AND conta_origem_id  = :c THEN -valor
            ELSE 0
          END), 0)
       FROM transacoes
       WHERE ${VIVA} AND situacao = 'efetivada' AND (ano * 12 + mes) <= :alvo
         AND (conta_id = :c OR conta_origem_id = :c OR conta_destino_id = :c)`,
      { ":c": contaId, ":alvo": alvo }
    ) ?? 0;
  return inicial + mov;
}

/** Saldo consolidado ao fim de uma competência: soma o resultado acumulado de cada conta. */
export const saldoNoMes = (mes, ano) =>
  todos(`SELECT id FROM contas WHERE ${VIVA} AND arquivada = 0`).reduce(
    (s, c) => s + saldoContaNoMes(c.id, mes, ano),
    0
  );

/**
 * Reservado nas metas. Metas são ENVELOPES: o dinheiro continua na conta, só está
 * prometido. Por isso não entra em saldoConta — se entrasse, o saldo deixaria de bater
 * com o extrato do banco. (Divergência do RN-686 — ver DECISOES.md §7.1.)
 */
export const totalReservado = () =>
  valor(
    `SELECT COALESCE(SUM(a.valor), 0) FROM aportes_meta a
     JOIN metas m ON m.id = a.meta_id
     WHERE a.excluido_em IS NULL AND m.excluido_em IS NULL AND m.arquivada = 0`
  ) ?? 0;

/** O que sobra de fato para gastar. */
export const saldoDisponivel = () => saldoTotal() - totalReservado();

/* ---------------- totais do mês ---------------- */

/** Receitas efetivadas do mês (RN-102). Transferência não é receita (RN-504). */
export const receitasDoMes = (mes, ano) =>
  valor(
    `SELECT COALESCE(SUM(valor), 0) FROM transacoes
     WHERE ${VIVA} AND tipo = 'receita' AND situacao = 'efetivada' AND mes = ? AND ano = ?`,
    [mes, ano]
  ) ?? 0;

/**
 * Despesas efetivadas do mês. Inclui despesa de cartão: o gasto aconteceu, mesmo que a
 * conta só sinta no pagamento da fatura. O pagamento da fatura é transferência e por
 * isso NÃO entra — senão o mesmo dinheiro contaria duas vezes.
 */
export const despesasDoMes = (mes, ano) =>
  valor(
    `SELECT COALESCE(SUM(valor), 0) FROM transacoes
     WHERE ${VIVA} AND tipo IN ('despesa','despesa_cartao') AND situacao = 'efetivada'
       AND mes = ? AND ano = ?`,
    [mes, ano]
  ) ?? 0;

/** Balanço mensal (glossário): receitas − despesas efetivadas do mês. */
export const balancoDoMes = (mes, ano) => receitasDoMes(mes, ano) - despesasDoMes(mes, ano);

/* ---------------- histórico manual dos meses anteriores ---------------- */

/** Totais informados à mão para um mês (ou null). */
export const historicoDoMes = (mes, ano) =>
  um("SELECT * FROM historico_mensal WHERE mes = ? AND ano = ?", [mes, ano]);

/* Para exibir: se o mês tem histórico informado à mão, usa-o; senão, calcula dos
   lançamentos. É o que faz um mês só de referência mostrar o valor certo sem ter os
   lançamentos, e um mês real mostrar o resultado ao vivo. */
export function receitasExibicao(mes, ano) {
  const h = historicoDoMes(mes, ano);
  return h ? h.entradas : receitasDoMes(mes, ano);
}
export function despesasExibicao(mes, ano) {
  const h = historicoDoMes(mes, ano);
  return h ? h.saidas : despesasDoMes(mes, ano);
}
export function saldoExibicao(mes, ano) {
  const h = historicoDoMes(mes, ano);
  return h && h.saldo != null ? h.saldo : saldoNoMes(mes, ano);
}

/* ---------------- cartão ---------------- */

/** Fatura de um cartão num mês: a fatura entra inteira no mês em que é paga, então
 *  basta somar o que foi lançado naquele mês (DECISOES.md §3). */
export const faturaDoMes = (cartaoId, mes, ano) =>
  valor(
    `SELECT COALESCE(SUM(valor), 0) FROM transacoes
     WHERE ${VIVA} AND tipo = 'despesa_cartao' AND cartao_id = ? AND mes = ? AND ano = ?`,
    [cartaoId, mes, ano]
  ) ?? 0;

/** Limite disponível (RN-301): limite − faturas em aberto. */
export function limiteDisponivel(cartaoId, mes, ano) {
  const limite = valor("SELECT limite FROM cartoes WHERE id = ?", [cartaoId]) ?? 0;
  return limite - faturaDoMes(cartaoId, mes, ano);
}

/* ---------------- investimentos ---------------- */

/**
 * Valor aplicado num investimento: o valor-base do cadastro (o que já estava aplicado
 * quando você começou) mais o líquido dos lançamentos — aportes somam, resgates subtraem.
 * Calcular por consulta em vez de guardar num campo evita dessincronizar quando um aporte
 * é editado ou apagado.
 */
export function aplicadoInvestimento(invId) {
  const base = valor("SELECT valor_aplicado FROM investimentos WHERE id = ?", [invId]) ?? 0;
  const mov =
    valor(
      `SELECT COALESCE(SUM(
          CASE WHEN conta_origem_id  IS NOT NULL THEN valor    -- aporte: saiu da conta
               WHEN conta_destino_id IS NOT NULL THEN -valor   -- resgate: voltou para a conta
               ELSE 0 END), 0)
       FROM transacoes
       WHERE ${VIVA} AND tipo = 'investimento' AND situacao = 'efetivada' AND investimento_id = ?`,
      [invId]
    ) ?? 0;
  return base + mov;
}

/** Patrimônio total: valor atual quando informado, senão o aplicado. */
export const totalInvestido = () =>
  todos(`SELECT id, valor_atual FROM investimentos WHERE ${VIVA} AND arquivado = 0`).reduce(
    (s, i) => s + (i.valor_atual != null ? i.valor_atual : aplicadoInvestimento(i.id)),
    0
  );

/* ---------------- despesas fixas (planejamento) ---------------- */

/** Competência como número comparável: Jul/2026 vira 24319. */
const ordem = (mes, ano) => ano * 12 + mes;

/**
 * Despesas fixas vigentes numa competência (RN-650), já com o ajuste e o pagamento do mês.
 *
 * A fixa é um MODELO: vale de `inicio` até `fim` (ou sem prazo). Para cada mês, a instância
 * em `fixas_mes` pode trazer um valor ajustado e um status. `valor` é o previsto do modelo,
 * ou o ajustado do mês quando houver. `pago_valor` é o valor real do lançamento do extrato
 * que a quitou — é ele quem conta no saldo; a fixa em si nunca entra em despesasDoMes.
 */
export function fixasDoMes(mes, ano, tipo = null) {
  const alvo = ordem(mes, ano);
  const params = [mes, ano];
  let filtroTipo = "";
  if (tipo) {
    filtroTipo = "AND f.tipo = ?";
    params.push(tipo);
  }
  params.push(alvo, alvo);
  const linhas = todos(
    `SELECT f.*, cat.nome AS categoria_nome, ct.nome AS conta_nome,
            fm.id AS instancia_id, fm.valor_ajustado, fm.status AS status_mes, fm.pago_em,
            (SELECT COUNT(*) FROM baixas b
             WHERE b.fixa_mes_id = fm.id AND b.excluido_em IS NULL) AS n_baixas,
            (SELECT COALESCE(SUM(b.valor), 0) FROM baixas b
             JOIN transacoes tx ON tx.id = b.transacao_id AND tx.excluido_em IS NULL
             WHERE b.fixa_mes_id = fm.id AND b.excluido_em IS NULL) AS soma_baixas
     FROM despesas_fixas f
     LEFT JOIN categorias cat ON cat.id = f.categoria_id
     LEFT JOIN contas ct ON ct.id = f.conta_id
     LEFT JOIN fixas_mes fm
            ON fm.fixa_id = f.id AND fm.mes = ? AND fm.ano = ? AND fm.excluido_em IS NULL
     WHERE f.${VIVA} AND f.ativa = 1 ${filtroTipo}
       AND (f.inicio_ano * 12 + f.inicio_mes) <= ?
       AND (f.fim_ano IS NULL OR (f.fim_ano * 12 + f.fim_mes) >= ?)
     ORDER BY f.dia_vencimento IS NULL, f.dia_vencimento, f.nome`,
    params
  );
  const agora = new Date();
  return linhas.map((f) => {
    const status = f.status_mes ?? "previsto";
    const valor = f.valor_ajustado ?? f.valor_previsto;
    const venc = dataVencimento(mes, ano, f.dia_vencimento);
    // Valor realizado: soma dos lançamentos vinculados; sem vínculo (baixa manual), o
    // próprio valor do mês.
    const pago_valor = f.n_baixas > 0 ? f.soma_baixas : valor;
    return {
      ...f,
      status,
      valor,
      pago_valor,
      venc: venc ? iso(venc) : null,
      // Vencida = ainda em aberto e o dia de vencimento já passou.
      vencida: status === "previsto" && venc && venc < agora,
    };
  });
}

/** Totais do planejamento do mês para um tipo: previsto, realizado (pago/recebido) e aberto. */
export function totalFixas(mes, ano, tipo = "despesa") {
  const fixas = fixasDoMes(mes, ano, tipo);
  const acc = { previsto: 0, pago: 0, aberto: 0, qtd: 0, qtdPagas: 0, qtdAberto: 0, qtdVencidas: 0 };
  for (const f of fixas) {
    if (f.status === "pulado") continue; // pulado no mês não compõe o previsto
    acc.qtd++;
    if (f.status === "pago") {
      const v = f.pago_valor ?? f.valor;
      acc.previsto += v;
      acc.pago += v;
      acc.qtdPagas++;
    } else {
      acc.previsto += f.valor;
      acc.aberto += f.valor;
      acc.qtdAberto++;
      if (f.vencida) acc.qtdVencidas++;
    }
  }
  return acc;
}
