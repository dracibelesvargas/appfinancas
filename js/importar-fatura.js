/**
 * Importador da fatura do C6 em PDF.
 *
 * O PDF é melhor que o CSV e por isso é o formato oficial (DECISOES.md §4). Ele traz o
 * que o CSV não tem: fechamento explícito, melhor dia de compra, limite, compras
 * internacionais separadas com cotação e IOF, parcela legível ("Parcela 2/6" em vez do
 * "02/jun" que o CSV manda mangled), estorno explícito e subtotal por cartão.
 *
 * E, principalmente: o PDF **declara os próprios totais**. Toda importação é conferida
 * contra eles. Um parser de PDF erra em silêncio — a conferência é o que impede isso de
 * virar dinheiro errado na tela.
 */

import { competencia, paraCentavos } from "./dominio.js";

const MESES_ABREV = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/* "  30 abr VG OFTALMOLOGIA LTDA - Parcela 2/6   2.150,00" — o valor fecha a linha. */
const LINHA = /^\s*(\d{1,2})\s+([a-z]{3})\s+(.+?)\s+(-?[\d.]+,\d{2})$/;

/* Compra internacional carrega um metadado que o PDF desenha ANTES do valor, e por
   isso ele cai dentro da descrição na reconstrução por linha:
     "WWW.USE.AI/US DO USD 0,50 | Cotação USD: R$5,43 2,72"
     "WWW.USE.AI/US DO IOF Transações Exterior 0,10"
   Achar o metadado pelo conteúdo (e não pela posição) é o que faz a conferência
   fechar: sem isso somem R$ 614,15 de compras internacionais e R$ 21,51 de IOF do
   lugar certo — o total continua correto, mas classificado errado. */
const RE_USD = /\s*USD\s+[\d.,]+\s*\|\s*Cota[çc][ãa]o\s+USD:\s*R\$\s*[\d.,]+\s*/i;
const RE_IOF_LINHA = /\s*IOF\s+Transa[çc][õo]es\s+Exterior\s*/i;

const RE_CARTAO = /Final (\d{4})/;
const RE_PARCELA = /-\s*Parcela\s+(\d+)\/(\d+)\s*$/i;
const RE_ESTORNO = /-\s*Estorno\s*$/i;
/* O pagamento da fatura anterior aparece na lista de lançamentos, mas não é compra:
   é o dinheiro entrando para quitar. Somá-lo inflaria a fatura em milhares. */
const RE_PAGAMENTO = /inclusao de pagamento|pagamento recebido/i;

/* "Cartão C6 Carbon" — o PDF diz o nome do cartão; não faz sentido pedir para digitar. */
const RE_NOME_CARTAO = /Cart[ãa]o\s+(C6\s+[A-Za-zÀ-ú]+)/i;
const RE_VENCIMENTO = /Data do vencimento:\s*(\d{1,2})\s+de\s+(\w+)/i;
const RE_FECHAMENTO = /transações feitas até\s+(\d{2})\/(\d{2})\/(\d{2})/i;
const RE_LIMITE = /Limite total:\s*R\$\s*([\d.]+,\d{2})/i;
const RE_MELHOR_DIA = /Melhor dia de compra:\s*(\d{1,2})/i;
const RE_TOTAL = /Total a pagar\s*R\$\s*([\d.]+,\d{2})/i;
const RE_NACIONAIS = /Compras nacionais\s+([\d.]+,\d{2})/i;
const RE_INTERNACIONAIS = /Compras internacionais\s+([\d.]+,\d{2})/i;
const RE_IOF = /IOF de financiamento e compras internacionais\s+([\d.]+,\d{2})/i;
const RE_ESTORNOS_TOTAL = /Estornos \/ Cr[ée]dito na Fatura\s*\(?-?\)?\s*([\d.]+,\d{2})/i;
const RE_FUTURAS = /Saldo obriga[çc][õo]es futuras\s*R\$\s*([\d.]+,\d{2})/i;

const MESES_LONGO = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

/** Extrai o texto de todas as páginas, preservando as quebras de linha. */
async function textoDoPdf(arquivo, senha) {
  const pdfjs = await import("../vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: bytes, password: senha || undefined }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") {
      const err = new Error("Esta fatura está protegida por senha.");
      err.precisaSenha = true;
      throw err;
    }
    throw new Error("Não consegui abrir o PDF.");
  }

  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pagina = await doc.getPage(i);
    const conteudo = await pagina.getTextContent();
    // Reconstrói as linhas pela posição vertical: o getTextContent devolve pedaços
    // soltos, e sem reagrupar por linha a data se separa do valor.
    const pedacos = conteudo.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    // Tolerância vertical: a fatura põe o metadado da compra internacional
    // ("USD 0,50 | Cotação USD: R$5,43") UM pixel acima da própria compra. Agrupar por
    // y exato separa os dois, e some o total de compras internacionais + IOF. As
    // transações ficam ~25px umas das outras, então 3px junta o que é da mesma linha
    // sem colar o que não é.
    const TOLERANCIA = 3;
    const linhas = [];
    let atual = null;
    for (const p of pedacos) {
      if (!atual || Math.abs(atual.y - p.y) > TOLERANCIA) {
        atual = { y: p.y, itens: [p] };
        linhas.push(atual);
      } else {
        atual.itens.push(p);
      }
    }
    paginas.push(
      linhas
        .map((l) =>
          l.itens.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim()
        )
        .join("\n")
    );
  }
  return paginas.join("\n");
}

const num = (t) => (t ? paraCentavos(t) : null);

/** Lê a fatura e devolve os lançamentos + a conferência contra os totais do PDF. */
export async function lerFatura(arquivo, { senha, mes, ano } = {}) {
  const texto = await textoDoPdf(arquivo, senha);

  // ---- cabeçalho
  const cab = {};
  const venc = texto.match(RE_VENCIMENTO);
  if (venc) {
    cab.dia_vencimento = Number(venc[1]);
    cab.mes_vencimento = MESES_LONGO[venc[2].toLowerCase()] ?? null;
  }
  const fech = texto.match(RE_FECHAMENTO);
  if (fech) {
    cab.dia_fechamento = Number(fech[1]);
    cab.fechou_em = `20${fech[3]}-${fech[2]}-${fech[1]}`;
  }
  cab.limite = num(texto.match(RE_LIMITE)?.[1]);
  cab.melhor_dia = Number(texto.match(RE_MELHOR_DIA)?.[1]) || null;
  cab.obrigacoes_futuras = num(texto.match(RE_FUTURAS)?.[1]);
  cab.nome_cartao = texto.match(RE_NOME_CARTAO)?.[1]?.trim() ?? null;

  // ---- totais declarados pelo próprio PDF
  const declarado = {
    total: num(texto.match(RE_TOTAL)?.[1]),
    nacionais: num(texto.match(RE_NACIONAIS)?.[1]),
    internacionais: num(texto.match(RE_INTERNACIONAIS)?.[1]),
    iof: num(texto.match(RE_IOF)?.[1]),
    estornos: num(texto.match(RE_ESTORNOS_TOTAL)?.[1]),
  };
  if (declarado.estornos > 0) declarado.estornos = -declarado.estornos;

  // ---- lançamentos
  const itens = [];
  const pagamentos = [];
  let cartao = null;
  const ocorrencias = new Map();

  for (const linha of texto.split("\n")) {
    const c = linha.match(RE_CARTAO);
    if (c) cartao = c[1];

    const m = linha.match(LINHA);
    if (!m) continue;
    const [, dia, mesAbrev, descBruta, valorTxt] = m;
    const mesNum = MESES_ABREV[mesAbrev];
    if (!mesNum) continue;

    let valor = paraCentavos(valorTxt);
    let descricao = descBruta.trim();

    // Metadado de compra internacional vem embutido na descrição — tirar dela e virar
    // classificação.
    const detalheUsd = descricao.match(RE_USD)?.[0]?.trim() || null;
    const ehIof = RE_IOF_LINHA.test(descricao);
    if (detalheUsd) descricao = descricao.replace(RE_USD, " ").replace(/\s+/g, " ").trim();
    if (ehIof) descricao = descricao.replace(RE_IOF_LINHA, " ").replace(/\s+/g, " ").trim();

    if (RE_ESTORNO.test(descricao)) {
      valor = -valor;
      descricao = descricao.replace(RE_ESTORNO, "").trim();
    }
    const p = descricao.match(RE_PARCELA);
    let parcelaNum = null;
    let parcelaTotal = null;
    if (p) {
      parcelaNum = Number(p[1]);
      parcelaTotal = Number(p[2]);
      descricao = descricao.replace(RE_PARCELA, "").trim();
    }

    // O ano não vem na linha (só "30 abr"). Deduz do fechamento: mês maior que o do
    // fechamento só pode ser do ano anterior.
    const anoRef = cab.fechou_em ? Number(cab.fechou_em.slice(0, 4)) : new Date().getFullYear();
    const mesFech = cab.fechou_em ? Number(cab.fechou_em.slice(5, 7)) : 12;
    const anoCompra = mesNum > mesFech ? anoRef - 1 : anoRef;
    const data = `${anoCompra}-${String(mesNum).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

    const registro = {
      data,
      descricao,
      valor,
      cartao,
      parcela_num: parcelaNum,
      parcela_total: parcelaTotal,
      exterior: !!detalheUsd,
      iof: ehIof,
      detalhe: detalheUsd,
    };

    if (RE_PAGAMENTO.test(descricao)) {
      pagamentos.push(registro);
      continue;
    }

    // Compras idênticas no mesmo dia acontecem de verdade (dois débitos de R$ 2,72 do
    // mesmo serviço aparecem nesta fatura). Sem contar a ocorrência, a segunda seria
    // tomada por duplicata e sumiria na reimportação.
    const chave = `${data}|${descricao}|${valor}|${cartao}`;
    const n = (ocorrencias.get(chave) ?? 0) + 1;
    ocorrencias.set(chave, n);
    registro.ocorrencia = n;
    itens.push(registro);
  }

  // ---- a fatura entra INTEIRA no mês em que é paga (DECISOES.md §3)
  let alvo = { mes, ano };
  if (!mes || !ano) {
    if (cab.dia_vencimento && cab.mes_vencimento) {
      const anoVenc = cab.fechou_em ? Number(cab.fechou_em.slice(0, 4)) : new Date().getFullYear();
      alvo = competencia(
        new Date(anoVenc, cab.mes_vencimento - 1, cab.dia_vencimento, 12)
      );
    } else {
      alvo = competencia(new Date());
    }
  }
  for (const i of itens) Object.assign(i, { mes: alvo.mes, ano: alvo.ano });

  // ---- conferência: o parser tem de fechar com o que o PDF diz
  const soma = (f) => itens.filter(f).reduce((s, i) => s + i.valor, 0);
  const estornos = soma((i) => i.valor < 0);
  const internacionais = soma((i) => i.exterior);
  const iof = soma((i) => i.iof);
  const total = itens.reduce((s, i) => s + i.valor, 0);
  // O PDF lista a anuidade fora de "compras nacionais"; para conferir, sai da conta.
  const anuidade = soma((i) => /anuidade/i.test(i.descricao));
  const nacionais = total - internacionais - iof - estornos - anuidade;

  const bate = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1;
  const conferencia = {
    total: { lido: total, pdf: declarado.total, ok: bate(total, declarado.total) },
    nacionais: { lido: nacionais, pdf: declarado.nacionais, ok: bate(nacionais, declarado.nacionais) },
    internacionais: {
      lido: internacionais,
      pdf: declarado.internacionais,
      ok: bate(internacionais, declarado.internacionais),
    },
    iof: { lido: iof, pdf: declarado.iof, ok: bate(iof, declarado.iof) },
    estornos: { lido: estornos, pdf: declarado.estornos, ok: bate(estornos, declarado.estornos) },
  };
  conferencia.confere = Object.values(conferencia).every((c) => c.ok !== false);

  return { cabecalho: cab, itens, pagamentos, conferencia, mes: alvo.mes, ano: alvo.ano };
}
