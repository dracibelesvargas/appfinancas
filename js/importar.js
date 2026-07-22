/**
 * Liga os leitores de PDF ao banco: confere, mostra e grava.
 *
 * Duas regras que valem para os dois arquivos:
 *
 * 1. **Nada entra sem conferir.** Fatura e extrato declaram os próprios totais. Se o
 *    que foi lido não bate, o app avisa em vez de gravar dinheiro errado — um parser de
 *    PDF que erra em silêncio é pior do que um que não funciona.
 *
 * 2. **Nada duplica.** Cada lançamento importado carrega uma impressão digital;
 *    reimportar o mesmo arquivo (ou um com período sobreposto) só acrescenta o que
 *    ainda não existe.
 */

import * as bd from "./banco.js";
import { chaveMerchant } from "./dominio.js";
import { lerFatura } from "./importar-fatura.js";
import { lerExtrato } from "./importar-extrato.js";

/** Identidade do lançamento importado. Texto legível de propósito: quando algo der
 *  errado, dá para ler a impressão e entender o que ela representa. */
const impressao = (...partes) =>
  partes
    .map((p) => String(p ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().trim())
    .join("|");

const catSemCategoria = (tipo) =>
  bd.um(
    "SELECT id FROM categorias WHERE do_sistema = 1 AND tipo = ? AND excluido_em IS NULL",
    [tipo === "receita" ? "receita" : "despesa"]
  )?.id ?? null;

const tipoBase = (tipo) => (tipo === "receita" ? "receita" : "despesa");

/**
 * Monta o mapa de aprendizado por comerciante a partir de tudo que já foi classificado:
 * chave "despesa|FACEBK" -> categoria. Cartão e conta compartilham o aprendizado (ambos
 * são "despesa"), então classificar a Amazon uma vez vale para os dois.
 */
function mapaAprendizado() {
  const mapa = {};
  for (const r of bd.todos(
    `SELECT descricao, tipo, categoria_id FROM transacoes
     WHERE excluido_em IS NULL AND categoria_id IS NOT NULL AND revisar = 0 AND descricao IS NOT NULL
     ORDER BY atualizado_em ASC`
  )) {
    const k = chaveMerchant(r.descricao);
    if (k) mapa[`${tipoBase(r.tipo)}|${k}`] = r.categoria_id; // ordem ASC: o mais recente vence
  }
  return mapa;
}

const aprendida = (mapa, descricao, tipo) => mapa[`${tipoBase(tipo)}|${chaveMerchant(descricao)}`] ?? null;

/**
 * Procura um lançamento PROVISÓRIO (lançado à mão a partir de uma notificação) que case com
 * um item importado — mesmo lugar (conta ou cartão), tipo e valor, com data próxima (±3
 * dias, pois a notificação e a data da fatura/extrato podem diferir). Devolve o id ou null.
 */
function conciliarProvisorio({ tipo, valor, contaId, cartaoId, data }) {
  const coluna = cartaoId ? "cartao_id" : "conta_id";
  const alvo = cartaoId || contaId;
  if (!alvo) return null;
  const linha = bd.um(
    `SELECT id FROM transacoes
     WHERE excluido_em IS NULL AND provisorio = 1 AND origem = 'manual'
       AND tipo = ? AND valor = ? AND ${coluna} = ?
       AND ABS(julianday(data) - julianday(?)) <= 3
     ORDER BY ABS(julianday(data) - julianday(?))
     LIMIT 1`,
    [tipo, valor, alvo, data, data]
  );
  return linha?.id ?? null;
}

/* ---------------- fatura ---------------- */

export async function analisarFatura(arquivo, { senha, mes, ano } = {}) {
  return lerFatura(arquivo, { senha, mes, ano });
}

/** Competência deslocada em `delta` meses. */
const somarMeses = (mes, ano, delta) => {
  const total = ano * 12 + (mes - 1) + delta;
  return { mes: (total % 12) + 1, ano: Math.floor(total / 12) };
};

export function gravarFatura(analise, { cartaoId, arquivo }) {
  let criados = 0;
  let duplicados = 0;
  let revisar = 0;
  let provisionados = 0;
  let conciliados = 0;

  bd.transacao(() => {
    const t = bd.agora();
    const disp = bd.idDispositivo();
    const semCat = catSemCategoria("despesa");
    const mapa = mapaAprendizado();

    for (const i of analise.itens) {
      // Compra parcelada: identidade estável da compra entre faturas (mesma descrição,
      // valor da parcela, total e cartão) — é o que casa a parcela real com a provisão.
      const parcelado = i.parcela_total && i.parcela_total > 1;
      const compraId = parcelado ? impressao("compra", i.cartao, i.descricao, i.valor, i.parcela_total) : null;

      // A impressão da parcela LEVA o nº: 2/6 e 3/6 têm data, descrição e valor iguais e,
      // sem o número, colidiriam — a parcela seguinte seria descartada como duplicata.
      const digital = parcelado
        ? impressao("fatura", i.data, i.descricao, i.valor, i.cartao, i.ocorrencia, i.parcela_num)
        : impressao("fatura", i.data, i.descricao, i.valor, i.cartao, i.ocorrencia);

      // Dedup: parcela pela dupla (compra, nº) já efetivada; os demais pela impressão.
      const jaReal = parcelado
        ? bd.um("SELECT id FROM transacoes WHERE excluido_em IS NULL AND compra_id = ? AND parcela_num = ? AND origem = 'importado'", [compraId, i.parcela_num])
        : bd.um("SELECT id FROM transacoes WHERE impressao = ?", [digital]);
      if (jaReal) {
        duplicados++;
        continue;
      }
      const cat = aprendida(mapa, i.descricao, "despesa") ?? semCat;
      const precisaRevisar = cat === semCat ? 1 : 0;

      // Um lançamento PROVISÓRIO da pessoa (notificação) que case: confirma-o em vez de
      // criar outro. Mantém a categoria que ela já deu; só alinha à fatura.
      const provManual = conciliarProvisorio({ tipo: "despesa_cartao", valor: i.valor, cartaoId, data: i.data });
      // Se esta parcela já foi PROVISIONADA por uma fatura anterior, converte a provisão.
      const convertida = parcelado && !provManual
        ? bd.um(
            "SELECT id FROM transacoes WHERE excluido_em IS NULL AND origem = 'provisionado' AND compra_id = ? AND parcela_num = ?",
            [compraId, i.parcela_num]
          )
        : null;

      if (provManual) {
        bd.executar(
          `UPDATE transacoes SET origem='importado', provisorio=0, situacao='efetivada', arquivo_origem=?,
                                 impressao=?, data=?, valor=?, mes=?, ano=?, cartao_id=?, compra_id=?,
                                 parcela_num=?, parcela_total=?, atualizado_em=? WHERE id=?`,
          [arquivo, digital, i.data, i.valor, i.mes, i.ano, cartaoId, compraId, i.parcela_num, i.parcela_total, t, provManual]
        );
        bd.enfileirar("transacoes", provManual, "update");
        conciliados++;
      } else if (convertida) {
        bd.executar(
          `UPDATE transacoes SET situacao='efetivada', origem='importado', arquivo_origem=?, impressao=?,
                                 data=?, valor=?, mes=?, ano=?, cartao_id=?, categoria_id=?, revisar=?,
                                 observacao=?, atualizado_em=? WHERE id=?`,
          [arquivo, digital, i.data, i.valor, i.mes, i.ano, cartaoId, cat, precisaRevisar, i.detalhe, t, convertida.id]
        );
        bd.enfileirar("transacoes", convertida.id, "update");
        criados++;
        revisar += precisaRevisar;
      } else {
        const id = bd.uuid();
        bd.executar(
          `INSERT INTO transacoes
            (id, tipo, valor, descricao, data, mes, ano, cartao_id, categoria_id, meio_pagamento,
             origem, arquivo_origem, impressao, situacao, revisar, compra_id, parcela_num, parcela_total,
             observacao, criado_em, atualizado_em, dispositivo)
           VALUES (?,'despesa_cartao',?,?,?,?,?,?,?,'credito','importado',?,?,'efetivada',?,?,?,?,?,?,?,?)`,
          [id, i.valor, i.descricao, i.data, i.mes, i.ano, cartaoId, cat, arquivo, digital,
           precisaRevisar, compraId, i.parcela_num, i.parcela_total, i.detalhe, t, t, disp]
        );
        bd.enfileirar("transacoes", id, "insert");
        criados++;
        revisar += precisaRevisar;
      }

      // Provisiona as parcelas futuras ainda inexistentes (pendentes, nos próximos meses).
      if (parcelado) {
        for (let k = i.parcela_num + 1; k <= i.parcela_total; k++) {
          const existe = bd.um(
            "SELECT id FROM transacoes WHERE excluido_em IS NULL AND compra_id = ? AND parcela_num = ?",
            [compraId, k]
          );
          if (existe) continue;
          const alvo = somarMeses(i.mes, i.ano, k - i.parcela_num);
          const provDig = impressao("provisao", compraId, k);
          const pid = bd.uuid();
          bd.executar(
            `INSERT INTO transacoes
              (id, tipo, valor, descricao, data, mes, ano, cartao_id, categoria_id, meio_pagamento,
               origem, arquivo_origem, impressao, situacao, revisar, compra_id, parcela_num, parcela_total,
               criado_em, atualizado_em, dispositivo)
             VALUES (?,'despesa_cartao',?,?,?,?,?,?,?,'credito','provisionado',?,?,'pendente',0,?,?,?,?,?,?)`,
            [pid, i.valor, i.descricao, i.data, alvo.mes, alvo.ano, cartaoId, cat, arquivo, provDig,
             compraId, k, i.parcela_total, t, t, disp]
          );
          bd.enfileirar("transacoes", pid, "insert");
          provisionados++;
        }
      }
    }

    // O cabeçalho da fatura preenche o cadastro do cartão: limite, fechamento,
    // vencimento e melhor dia vêm de graça no PDF.
    const c = analise.cabecalho;
    if (cartaoId && (c.limite || c.dia_fechamento || c.dia_vencimento)) {
      bd.executar(
        `UPDATE cartoes SET limite = COALESCE(?, limite),
                            dia_fechamento = COALESCE(?, dia_fechamento),
                            dia_vencimento = COALESCE(?, dia_vencimento),
                            atualizado_em = ?
         WHERE id = ?`,
        [c.limite ?? null, c.dia_fechamento ?? null, c.dia_vencimento ?? null, t, cartaoId]
      );
    }
  });

  return { criados, duplicados, revisar, provisionados, conciliados, pagamentos: analise.pagamentos.length };
}

/* ---------------- extrato ---------------- */

export const ehOfx = (arquivo) => /\.ofx$/i.test(arquivo.name);

export async function analisarExtrato(arquivo, opts = {}) {
  if (ehOfx(arquivo)) {
    const { lerExtratoOFX } = await import("./importar-ofx.js");
    // O nome do titular, aprendido de uma importação anterior, refina a classificação de
    // Pix entre contas próprias — o OFX não traz esse nome.
    return lerExtratoOFX(arquivo, { ...opts, titular: opts.titular ?? bd.config("titular_nome") });
  }
  return lerExtrato(arquivo, opts);
}

export function gravarExtrato(analise, { contaId, cartaoId, arquivo }) {
  let criados = 0;
  let duplicados = 0;
  let revisar = 0;
  let conciliados = 0;

  bd.transacao(() => {
    const t = bd.agora();
    const disp = bd.idDispositivo();

    // OFX traz o titular só quando já foi aprendido; se veio, guarda para as próximas.
    if (analise.cabecalho?.titular) bd.definirConfig("titular_nome", analise.cabecalho.titular);
    const mapa = mapaAprendizado();

    // Dedup cross-formato (PDF x OFX): a impressão difere entre os formatos, mas o mesmo
    // lançamento tem a mesma chave natural (conta + data + valor). Conta quantos já existem
    // por chave e não reinsere além disso — sem barrar duplicatas legítimas do dia.
    const chaveNatural = (i) => `${i.data}|${i.valor}`;
    const restantesPorChave = new Map();
    const jaTem = (i) => {
      const k = chaveNatural(i);
      if (!restantesPorChave.has(k)) {
        restantesPorChave.set(
          k,
          bd.valor(
            `SELECT COUNT(*) FROM transacoes WHERE excluido_em IS NULL AND origem = 'importado'
               AND data = ? AND valor = ?
               AND (conta_id = ? OR conta_origem_id = ? OR conta_destino_id = ?)`,
            [i.data, i.valor, contaId, contaId, contaId]
          ) ?? 0
        );
      }
      return restantesPorChave.get(k);
    };

    for (const i of analise.itens) {
      // OFX tem ID único (FITID) — dedup à prova; PDF cai na impressão heurística.
      const digital = i.fitid
        ? impressao("ofx", i.fitid)
        : impressao("extrato", i.data, i.descricao, i.valor, i.rotulo, i.ocorrencia);
      if (bd.um("SELECT id FROM transacoes WHERE impressao = ?", [digital])) {
        duplicados++;
        continue;
      }
      // Já existe o mesmo lançamento vindo do outro formato? Consome uma "vaga" e pula.
      const restam = jaTem(i);
      if (restam > 0) {
        restantesPorChave.set(chaveNatural(i), restam - 1);
        duplicados++;
        continue;
      }

      const ehTransf = i.tipo === "transferencia";
      const cat = ehTransf ? null : aprendida(mapa, i.descricao, i.tipo) ?? catSemCategoria(i.tipo);
      // Já classificado pelo histórico não precisa entrar na fila.
      const precisaRevisar = ehTransf ? i.revisar : cat === catSemCategoria(i.tipo) ? 1 : 0;

      // Um lançamento PROVISÓRIO (notificação) que case com uma despesa/receita importada:
      // confirma-o em vez de duplicar. Transferências não conciliam.
      const provManual = ehTransf ? null : conciliarProvisorio({ tipo: i.tipo, valor: i.valor, contaId, data: i.data });
      if (provManual) {
        bd.executar(
          `UPDATE transacoes SET origem='importado', provisorio=0, situacao='efetivada', arquivo_origem=?,
                                 impressao=?, data=?, valor=?, mes=?, ano=?, meio_pagamento=?, atualizado_em=? WHERE id=?`,
          [arquivo, digital, i.data, i.valor, i.mes, i.ano, i.meio_pagamento, t, provManual]
        );
        bd.enfileirar("transacoes", provManual, "update");
        conciliados++;
        continue;
      }

      // Transferência precisa saber a direção. O extrato traz o sinal; sem ele, um Pix
      // RECEBIDO entraria como saída e o saldo erra pelo dobro do valor.
      const origem = ehTransf && !i.entrada ? contaId : null;
      const destino = ehTransf && i.entrada ? contaId : null;

      const id = bd.uuid();
      bd.executar(
        `INSERT INTO transacoes
          (id, tipo, valor, descricao, data, mes, ano, conta_id, conta_origem_id,
           conta_destino_id, cartao_id, categoria_id, meio_pagamento, origem, arquivo_origem,
           impressao, situacao, revisar, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'importado',?,?,'efetivada',?,?,?,?)`,
        [
          id, i.tipo, i.valor, i.descricao, i.data, i.mes, i.ano,
          ehTransf ? null : contaId,
          origem,
          destino,
          // Pagamento da fatura: sai da conta, entra no cartão.
          i.e_pagamento_fatura ? cartaoId : null,
          cat, i.meio_pagamento, arquivo, digital, precisaRevisar, t, t, disp,
        ]
      );
      bd.enfileirar("transacoes", id, "insert");
      criados++;
      revisar += precisaRevisar;
    }
  });

  return { criados, duplicados, revisar, conciliados };
}

/* ---------------- despacho ---------------- */

export const ehPdf = (arquivo) => /\.pdf$/i.test(arquivo.name);

/** Descobre se o PDF pede senha, sem processá-lo — para pedir a senha antes de ler. */
export async function pedeSenha(arquivo) {
  const pdfjs = await import("../vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  try {
    await pdfjs.getDocument({ data: bytes }).promise;
    return false;
  } catch (e) {
    return e?.name === "PasswordException";
  }
}

export async function analisar(especie, arquivo, opcoes) {
  if (especie === "extrato" && ehOfx(arquivo)) return analisarExtrato(arquivo, opcoes);
  if (!ehPdf(arquivo)) {
    throw new Error("Escolha um PDF (fatura ou extrato) ou um OFX (extrato) do C6.");
  }
  return especie === "fatura" ? analisarFatura(arquivo, opcoes) : analisarExtrato(arquivo, opcoes);
}

export const gravar = (especie, analise, opcoes) =>
  especie === "fatura" ? gravarFatura(analise, opcoes) : gravarExtrato(analise, opcoes);
