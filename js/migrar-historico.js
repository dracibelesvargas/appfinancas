/**
 * Importa uma vez o histórico Jan–Jun vindo da planilha (via app antigo).
 *
 * O JSON é gerado por `ferramentas/gerar-historico.py`, que confere os totais contra o
 * app antigo mês a mês antes de escrever.
 *
 * Além de trazer o passado, isto **ensina o app**: cada descrição já classificada vira
 * fonte para a próxima importação de fatura/extrato reconhecer a categoria sozinha.
 */

import * as bd from "./banco.js";

const CAMINHO = "./dados/historico-2026.json";

export const jaMigrado = () => bd.config("historico_migrado") === "1";

/** Impressão digital do histórico: reimportar não pode duplicar. */
const digital = (l, n) =>
  ["hist", l.data, l.descricao ?? "", l.valor, l.categoria ?? "", l.mes, n]
    .map((p) => String(p).toUpperCase().trim())
    .join("|");

export async function migrar({ contaId, cartaoId } = {}) {
  const resp = await fetch(CAMINHO);
  if (!resp.ok) throw new Error("Não encontrei o arquivo do histórico.");
  const dados = await resp.json();

  const t = bd.agora();
  const disp = bd.idDispositivo();
  let criados = 0;
  let duplicados = 0;

  bd.transacao(() => {
    // --- grupos
    const grupos = {};
    for (const g of bd.todos("SELECT id, nome FROM grupos_categoria WHERE excluido_em IS NULL")) {
      grupos[g.nome] = g.id;
    }

    // --- categorias
    const cats = {};
    for (const c of bd.todos("SELECT id, nome, tipo FROM categorias WHERE excluido_em IS NULL")) {
      cats[`${c.tipo}|${c.nome}`] = c.id;
    }
    for (const c of dados.categorias) {
      const chave = `${c.tipo}|${c.nome}`;
      if (cats[chave]) continue;
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO categorias (id, nome, tipo, icone, grupo_id, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, c.nome, c.tipo, c.icone ?? null, grupos[c.grupo] ?? null, t, t, disp]
      );
      cats[chave] = id;
      bd.enfileirar("categorias", id, "insert");
    }

    // --- lançamentos
    const ocorrencias = new Map();
    for (const l of dados.lancamentos) {
      const chave = digital(l, "");
      const n = (ocorrencias.get(chave) ?? 0) + 1;
      ocorrencias.set(chave, n);
      const imp = digital(l, n);

      if (bd.um("SELECT id FROM transacoes WHERE impressao = ?", [imp])) {
        duplicados++;
        continue;
      }

      const ehReceita = l.tipo === "receita";
      // "Outros" é a catch-all do sistema; o histórico antigo usava "Sem categoria".
      const semCat = (t) => cats[`${t}|Outros`] ?? cats[`${t}|Sem categoria`] ?? null;
      const nomeCat = l.categoria === "Sem categoria" ? "Outros" : l.categoria;
      const catId = ehReceita ? semCat("receita") : cats[`despesa|${nomeCat}`] ?? semCat("despesa");

      // Compra no crédito da planilha não tem cartão identificado item a item; sem
      // cartão ela não pode ser despesa_cartao (comporia uma fatura que não existe).
      // Fica como despesa comum: é o que o histórico sabe de verdade.
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO transacoes
           (id, tipo, valor, descricao, data, mes, ano, conta_id, categoria_id, meio_pagamento,
            origem, arquivo_origem, impressao, situacao, revisar, parcela_num, parcela_total,
            criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?,?,'importado','planilha 2026',?,?,0,?,?,?,?,?)`,
        [
          id, ehReceita ? "receita" : "despesa", l.valor, l.descricao ?? null, l.data,
          l.mes, l.ano, contaId ?? null, catId, l.meio ?? "debito", imp,
          l.situacao ?? "efetivada", null, null, t, t, disp,
        ]
      );
      bd.enfileirar("transacoes", id, "insert");
      criados++;
    }

    // --- nomes de entrada que já existiram viram sugestão
    for (const nome of dados.nomes_entrada ?? []) {
      bd.executar(
        `INSERT INTO config (chave, valor, atualizado_em) VALUES (?,?,?)
         ON CONFLICT(chave) DO NOTHING`,
        [`entrada_nome|${nome}`, nome, t]
      );
    }

    bd.definirConfig("historico_migrado", "1");
  });

  await bd.gravar();
  return { criados, duplicados, resumo: dados.resumo, naoMigrado: dados.nao_migrado };
}
