/**
 * Importador do extrato do C6 em PDF.
 *
 * Como a fatura, o extrato **declara os próprios totais** por mês ("Entradas: R$ X •
 * Saídas: R$ Y"). Toda importação confere contra eles: se uma linha escapar do parser,
 * a conta não fecha e o app avisa em vez de mostrar dinheiro errado.
 */

import { competencia, paraCentavos } from "./dominio.js";

/* "25/06 25/06 Saída PIX Pix enviado para FULANO -R$ 1.850,00" */
const LINHA = /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+(-?R\$\s*[\d.,]+)$/;

/* "Junho 2026 ( 24/06/2026 - 30/06/2026 ) Entradas: R$ 18.450,00 • Saídas: R$ 33.546,89" */
const CABECALHO_MES =
  /^(\w+)\s+(\d{4})\s*\(.*?\).*?Entradas:\s*(R\$\s*[\d.,]+).*?Sa[íi]das:\s*(R\$\s*[\d.,]+)/i;

/* "MAURO SANTOS DE VARGAS • 009.891.030-21" */
const TITULAR = /^([A-ZÀ-Ú][A-ZÀ-Ú\s]+?)\s+[•·]\s+\d{3}\.\d{3}\.\d{3}-\d{2}/;
/* "Agência: 1 • Conta: 343774402" e "Saldo do dia • 16 de julho de 2026 • R$ 9.126,79":
   o extrato identifica a conta e diz o saldo. Pedir isso digitado seria pedir de novo o
   que o arquivo já entrega. */
const RE_AGENCIA_CONTA = /Ag[êe]ncia:\s*(\S+)\s*[•·]\s*Conta:\s*(\S+)/i;
const RE_SALDO_ATUAL = /Saldo do dia\s*[•·].*?[•·]\s*(-?R\$\s*[\d.,]+)/i;

const SALDO_DIA = /^saldo do dia/i;

/* O pagamento da fatura descreve o mesmo dinheiro que as compras da fatura já contam.
   Com contas no modelo ele vira uma TRANSFERÊNCIA conta -> cartão: sai da conta de
   verdade, mas não é despesa nova. */
const PGTO_FATURA = /pgto\s*fat|pagamento.*fatura|fat\s*cart[ãa]o/i;

const ROTULOS = ["Entrada PIX", "Saída PIX", "Débito de Cartão", "Pagamento", "Entrada", "Saída"];

const MEIO = {
  "Saída PIX": "pix",
  "Entrada PIX": "pix",
  "Débito de Cartão": "debito",
  Pagamento: "boleto",
};

const MESES_LONGO = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const normalizar = (t) =>
  (t || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

async function textoDoPdf(arquivo, senha) {
  const pdfjs = await import("../vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, password: senha || undefined }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") {
      const err = new Error("Este extrato está protegido por senha.");
      err.precisaSenha = true;
      throw err;
    }
    throw new Error("Não consegui abrir o PDF.");
  }

  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const conteudo = await (await doc.getPage(i)).getTextContent();
    const pedacos = conteudo.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    // Mesma tolerância vertical da fatura: pedaços da mesma linha não caem exatamente
    // no mesmo y, e agrupar por y exato parte a linha ao meio.
    const linhas = [];
    let atual = null;
    for (const p of pedacos) {
      if (!atual || Math.abs(atual.y - p.y) > 3) {
        atual = { y: p.y, itens: [p] };
        linhas.push(atual);
      } else {
        atual.itens.push(p);
      }
    }
    paginas.push(
      linhas
        .map((l) => l.itens.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim())
        .join("\n")
    );
  }
  return paginas.join("\n");
}

function separarRotulo(resto) {
  for (const r of ROTULOS) {
    if (resto.startsWith(r)) return [r, resto.slice(r.length).trim()];
  }
  const [primeiro, ...rest] = resto.split(" ");
  return [primeiro, rest.join(" ")];
}

/**
 * Lê o extrato e devolve os lançamentos + a conferência contra os totais do PDF.
 * `contaId` e `cartaoId` dizem a que conta o extrato pertence e para qual cartão vai o
 * pagamento da fatura.
 */
export async function lerExtrato(arquivo, { senha, contaId, cartaoId } = {}) {
  const texto = await textoDoPdf(arquivo, senha);
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);

  let titular = "";
  const cabecalho = {};
  for (const l of linhas.slice(0, 12)) {
    const m = l.match(TITULAR);
    if (m && !titular) titular = normalizar(m[1]);
    const ac = l.match(RE_AGENCIA_CONTA);
    if (ac) {
      cabecalho.agencia = ac[1];
      cabecalho.conta = ac[2];
    }
    const s = l.match(RE_SALDO_ATUAL);
    if (s) cabecalho.saldo_atual = paraCentavos(s[1]);
  }
  cabecalho.titular = titular;

  const itens = [];
  const conferencia = [];
  const ocorrencias = new Map();
  let anoCorrente = null;
  let blocoAtual = null;

  for (const linha of linhas) {
    const cab = linha.match(CABECALHO_MES);
    if (cab) {
      anoCorrente = Number(cab[2]);
      blocoAtual = {
        mes: cab[1],
        mes_num: MESES_LONGO[cab[1].toLowerCase()] ?? null,
        ano: anoCorrente,
        entradas_pdf: paraCentavos(cab[3]) ?? 0,
        saidas_pdf: paraCentavos(cab[4]) ?? 0,
        entradas_lidas: 0,
        saidas_lidas: 0,
      };
      conferencia.push(blocoAtual);
      continue;
    }
    if (SALDO_DIA.test(linha)) continue;

    const m = linha.match(LINHA);
    if (!m) continue;
    const [, diaMes, , resto, valorTxt] = m;
    const valor = paraCentavos(valorTxt);
    if (valor === null) continue;

    // Soma bruta pelo sinal do próprio extrato, só para conferir contra o PDF. Se
    // bater, nenhuma linha escapou.
    if (blocoAtual) {
      if (valor >= 0) blocoAtual.entradas_lidas += valor;
      else blocoAtual.saidas_lidas += -valor;
    }

    const [rotulo, descricao] = separarRotulo(resto);
    const [dia, mesCal] = diaMes.split("/").map(Number);
    const ano = anoCorrente ?? new Date().getFullYear();
    const data = `${ano}-${String(mesCal).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const { mes, ano: anoComp } = competencia(data);

    const ehPgtoFatura = PGTO_FATURA.test(descricao);
    // Pix de/para o próprio titular: dinheiro que só muda de banco, não é receita nem
    // despesa. Fica marcado para revisão — é decisão de quem lança, não do parser.
    const ehProprio = !!titular && normalizar(descricao).includes(titular);

    let tipo;
    let revisar = 0;
    if (ehPgtoFatura) {
      tipo = "transferencia";
    } else if (ehProprio) {
      tipo = "transferencia";
      revisar = 1;
    } else if (valor > 0) {
      tipo = "receita";
    } else {
      tipo = "despesa";
      revisar = 1; // sem categoria ainda
    }

    const chave = `${data}|${descricao}|${valor}|${rotulo}`;
    const n = (ocorrencias.get(chave) ?? 0) + 1;
    ocorrencias.set(chave, n);

    itens.push({
      data,
      mes,
      ano: anoComp,
      tipo,
      // O sinal mora no tipo, como no resto do banco — mas transferência não tem sinal
      // no tipo: ela precisa saber se o dinheiro ENTROU ou SAIU da conta, senão um Pix
      // recebido debita em vez de creditar.
      entrada: valor > 0,
      valor: Math.abs(valor),
      descricao,
      rotulo,
      meio_pagamento: MEIO[rotulo] ?? "debito",
      conta_id: contaId ?? null,
      cartao_id: ehPgtoFatura ? cartaoId ?? null : null,
      revisar,
      ocorrencia: n,
      e_pagamento_fatura: ehPgtoFatura,
      e_proprio_titular: ehProprio,
    });
  }

  for (const c of conferencia) {
    c.ok =
      Math.abs(c.entradas_lidas - c.entradas_pdf) < 1 && Math.abs(c.saidas_lidas - c.saidas_pdf) < 1;
  }

  return {
    titular,
    cabecalho,
    itens,
    conferencia,
    confere: conferencia.length ? conferencia.every((c) => c.ok) : null,
  };
}
