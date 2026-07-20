/**
 * Importador de extrato em OFX (Open Financial Exchange) — o formato do "extrato para
 * seu contador" do C6.
 *
 * Por que preferir OFX ao PDF (DECISOES.md §4.1): é estruturado, então não depende de
 * reconstruir linha por posição de texto. Traz o SINAL do valor (TRNAMT negativo = saída),
 * o que resolve a direção do Pix na origem, e um ID único por lançamento (FITID) — a chave
 * de deduplicação perfeita, melhor que a impressão heurística do PDF.
 *
 * Devolve os itens no MESMO formato que o extrato em PDF, então quem grava é o mesmo
 * `gravarExtrato`.
 */

import { competencia, paraCentavos } from "./dominio.js";

/* Pagamento de fatura: sai da conta, mas não é despesa nova — vira transferência p/ cartão. */
const PGTO_FATURA = /pgto\s*fat|pagamento.*fatura|fat\s*cart[ãa]o/i;

const normalizar = (t) =>
  (t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Valor de um campo OFX. Tolerante a SGML: pega o texto após <TAG> até o próximo `<`,
 *  funcione a tag fechada (`<X>v</X>`) ou não (`<X>v`). */
function campo(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : null;
}

/** "20260702155704[-3:BRT]" -> "2026-07-02" */
function dataOFX(dt) {
  const s = (dt || "").replace(/[^0-9]/g, "").slice(0, 8);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

/**
 * Interpreta o texto OFX e devolve { cabecalho, itens }. `titular` (nome do dono da conta),
 * quando conhecido, permite marcar Pix de/para a própria pessoa como transferência.
 */
export function parseOFX(texto, { contaId, cartaoId, titular } = {}) {
  const acct = texto.match(/<BANKACCTFROM>([\s\S]*?)<\/BANKACCTFROM>/i)?.[1] ?? texto;
  const cabecalho = {
    banco: campo(acct, "BANKID"),
    agencia: campo(acct, "BRANCHID"),
    conta: campo(acct, "ACCTID"),
    instituicao: texto.match(/<ORG>\s*([^<\r\n]*)/i)?.[1]?.trim() ?? null,
    titular: titular ?? null,
  };
  const tit = titular ? normalizar(titular) : "";

  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  const itens = [];
  const ocorrencias = new Map();

  for (const raw of blocos) {
    const bloco = raw.split(/<\/STMTTRN>/i)[0];
    const valorAss = paraCentavos(campo(bloco, "TRNAMT"));
    const data = dataOFX(campo(bloco, "DTPOSTED"));
    if (valorAss === null || !data) continue;

    const memo = (campo(bloco, "MEMO") || campo(bloco, "NAME") || "").trim();
    const fitid = campo(bloco, "FITID") || null;
    const { mes, ano } = competencia(data);
    const ehPix = /pix/i.test(memo);

    const ehPgtoFatura = PGTO_FATURA.test(memo);
    // Pix de/para o próprio titular: só muda de banco, não é receita nem despesa.
    const ehProprio = !!tit && normalizar(memo).includes(tit);

    let tipo;
    let revisar = 0;
    let rotulo;
    if (ehPgtoFatura) {
      tipo = "transferencia";
      rotulo = "Pagamento";
    } else if (ehProprio) {
      tipo = "transferencia";
      revisar = 1;
      rotulo = valorAss > 0 ? "Entrada PIX" : "Saída PIX";
    } else if (valorAss > 0) {
      tipo = "receita";
      rotulo = ehPix ? "Entrada PIX" : "Entrada";
    } else {
      tipo = "despesa";
      revisar = 1;
      rotulo = ehPix ? "Saída PIX" : "Saída";
    }

    // O FITID já é único; a ocorrência só cobre o caso raro de OFX sem FITID.
    const chave = fitid || `${data}|${memo}|${valorAss}`;
    const n = (ocorrencias.get(chave) ?? 0) + 1;
    ocorrencias.set(chave, n);

    itens.push({
      data, mes, ano, tipo,
      entrada: valorAss > 0,
      valor: Math.abs(valorAss),
      descricao: memo,
      rotulo,
      meio_pagamento: ehPix ? "pix" : "debito",
      conta_id: contaId ?? null,
      cartao_id: ehPgtoFatura ? cartaoId ?? null : null,
      revisar,
      ocorrencia: n,
      e_pagamento_fatura: ehPgtoFatura,
      e_proprio_titular: ehProprio,
      fitid,
    });
  }

  // OFX não declara totais mensais como o PDF, então não há conferência aritmética aqui —
  // o FITID já garante que nada duplica.
  return { cabecalho, itens, conferencia: [], confere: null };
}

export async function lerExtratoOFX(arquivo, opts = {}) {
  return parseOFX(await arquivo.text(), opts);
}
