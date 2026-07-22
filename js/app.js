/** Casca do app: navegação, telas e formulários. Regra de dinheiro mora em dominio.js. */

import * as bd from "./banco.js";
import * as imp from "./importar.js";
import * as hist from "./migrar-historico.js";
import * as nuvem from "./nuvem.js";
import {
  MESES, MESES_LONGO, aplicadoInvestimento, brl, chaveMerchant, competencia, dataBR, dataVencimento, despesasDoMes,
  despesasExibicao, faturaDoMes, fixasDoMes, historicoDoMes, iso, limiteDisponivel, mesEhProjetado,
  paraCentavos, previstoDoMes, receitasDoMes, receitasExibicao, saldoConta, saldoContaNoMes,
  saldoDisponivel, saldoExibicao, saldoNoMes, saldoTotal, totalFixas, totalInvestido, totalReservado,
} from "./dominio.js";

const hoje = new Date();

/* Auto-backup na nuvem: agenda um envio 90s após a última mudança, agrupando várias
   gravações num upload só. Silencioso — falha de rede não incomoda a pessoa. */
let timerNuvem = null;
let statusNuvem = "ocioso"; // ocioso | pendente | enviando | enviado | erro
function agendarNuvem() {
  if (!nuvem.estaConfigurado()) return;
  statusNuvem = "pendente";
  pintarNuvem();
  clearTimeout(timerNuvem);
  timerNuvem = setTimeout(enviarNuvem, 90000);
}
async function enviarNuvem() {
  if (!nuvem.estaConfigurado()) return false;
  statusNuvem = "enviando";
  pintarNuvem();
  try {
    await nuvem.enviar(bd.exportarBytes());
    statusNuvem = "enviado";
    pintarNuvem();
    if (estado.tela === "mais") render();
    return true;
  } catch (e) {
    statusNuvem = "erro";
    pintarNuvem();
    console.warn("Auto-backup na nuvem falhou (tentará na próxima mudança):", e.message);
    return false;
  }
}

/** Pinta o indicador de backup no topo conforme o estado + validade do token. */
function pintarNuvem() {
  const b = $("#btn-nuvem");
  if (!b) return;
  // style.display vence o [hidden] (que o CSS do .icone-topo sobrepõe).
  if (!nuvem.estaConfigurado()) { b.style.display = "none"; return; }
  b.style.display = "";
  const temUltimo = !!nuvem.info().ultimo;
  const mapa = {
    pendente: ["#e0a23b", "Backup pendente…"],
    enviando: ["#e0a23b", "Enviando backup…"],
    enviado: ["#1baf7a", "Backup enviado"],
    erro: ["#d9654b", "Falha no backup — toque para reenviar"],
    ocioso: [temUltimo ? "#1baf7a" : "#8a94a6", temUltimo ? "Backup em dia" : "Backup ainda não enviado"],
  };
  let [cor, titulo] = mapa[statusNuvem] || mapa.ocioso;
  const dias = nuvem.diasParaExpirar();
  if (dias != null && dias <= 10) {
    cor = "#d9654b";
    titulo = dias < 0 ? "Token do backup expirou — renove" : `Token do backup expira em ${dias} dia(s)`;
  }
  b.style.color = cor;
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
}

/** Formata um timestamp ISO no fuso local (mostrar só o slice do ISO exibia UTC, +3h). */
const dataHoraBR = (iso) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
// O mês corrente só pode ser calculado DEPOIS de abrir o banco: a virada (dia 25) é uma
// configuração. Calcular aqui, no carregamento do módulo, consultaria um banco que
// ainda não existe.
const estado = { tela: "principal", mes: null, ano: null, ocultar: false };

/* ---------------- utilidades de DOM ---------------- */

const $ = (s) => document.querySelector(s);

function el(tag, attrs = {}, filhos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const f of [].concat(filhos)) if (f) n.append(f);
  return n;
}

const svg = (d) =>
  el("span", { html: `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>` }).firstChild;

/** Respeita o "ocultar valores" (RN-103). */
const $$ = (centavos) =>
  estado.ocultar ? "R$ ••••" : brl(centavos);

const ICONES = {
  seta_baixo: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  alerta: '<path d="M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  carteira: '<path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M16 12h.01"/>',
  cartao: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  grafico: '<path d="M21 12a9 9 0 11-9-9v9z"/><path d="M12 3a9 9 0 019 9h-9z"/>',
  alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  repetir: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
  ok: '<path d="M20 6L9 17l-5-5"/>',
  calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  painel: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7"/><rect x="12" y="6" width="3" height="11"/><rect x="17" y="13" width="3" height="4"/>',
};

/* Paleta categórica dos gráficos: ordem fixa (a mesma categoria mantém a cor). */
const CORES_GRAF = ["#2a78d6", "#e87ba4", "#1baf7a", "#e0a23b", "#9b6cd6", "#4bb3c4", "#d9654b", "#7a9b3b", "#c44b9b", "#8a94a6"];

/* ---------------- telas ---------------- */

function render() {
  const c = $("#conteudo");
  c.innerHTML = "";
  $("#mes-nome").textContent = `${MESES_LONGO[estado.mes - 1]} ${estado.ano}`;
  document.querySelectorAll(".aba").forEach((a) =>
    a.setAttribute("aria-selected", String(a.dataset.tela === estado.tela))
  );
  ({ principal: telaPrincipal, transacoes: telaTransacoes, planejamento: telaPlanejamento,
     dashboard: telaDashboard, mais: telaMais }[
    estado.tela
  ] || telaPrincipal)(c);
  pintarNuvem();
}

function telaPrincipal(c) {
  const receitas = receitasExibicao(estado.mes, estado.ano);
  const despesas = despesasExibicao(estado.mes, estado.ano);
  const reservado = totalReservado();
  const ehHistorico = !!historicoDoMes(estado.mes, estado.ano);
  const ehProjetado = mesEhProjetado(estado.mes, estado.ano);

  // Resumo
  const saldoMes = saldoExibicao(estado.mes, estado.ano);
  const resumo = el("section", { class: "resumo" });
  resumo.append(
    el("div", { class: "resumo-rotulo", text:
      `Saldo em ${MESES_LONGO[estado.mes - 1]}` + (ehHistorico ? " · referência" : ehProjetado ? " · previsto" : "") }),
    el("div", { class: "resumo-saldo", text: $$(saldoMes) })
  );
  if (reservado > 0) {
    // Metas são envelopes: o dinheiro continua na conta, mas não está livre. Mostrar só
    // o saldo cheio faria parecer disponível o que já tem dono.
    resumo.append(
      el("div", {
        class: "resumo-sub",
        text: `${$$(saldoMes - reservado)} disponível · ${$$(reservado)} reservado em metas`,
      })
    );
  }
  const olho = el("button", { class: "olho", type: "button", "aria-label": "Ocultar valores" });
  olho.append(
    svg(
      estado.ocultar
        ? '<path d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2"/><path d="M9.4 5.2A9.7 9.7 0 0112 5c5 0 9 4.5 9 7a12 12 0 01-2.3 3.2M6.2 6.7A12.6 12.6 0 003 12c0 2.5 4 7 9 7 1.4 0 2.6-.3 3.8-.8"/>'
        : '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'
    )
  );
  olho.onclick = () => {
    estado.ocultar = !estado.ocultar;
    bd.definirConfig("ocultar_valores", estado.ocultar ? "1" : "0");
    render();
  };
  resumo.append(olho);

  const dois = el("div", { class: "dois" });
  for (const [rot, val, dir, filtro] of [
    ["Entradas", receitas, "up", "receita"],
    ["Saídas", despesas, "down", "despesa"],
  ]) {
    const ic = el("span", { class: `fluxo-icone ${dir}` });
    ic.append(svg(dir === "up" ? '<path d="M12 19V5M5 12l7-7 7 7"/>' : '<path d="M12 5v14M5 12l7 7 7-7"/>'));
    // Clicar no total mostra os lançamentos que o compõem.
    const fluxo = el("button", { class: "fluxo", type: "button", style: "background:none;border:none;cursor:pointer;width:100%" }, [
      ic,
      el("div", {}, [
        el("div", { class: "fluxo-rotulo", text: rot }),
        el("div", { class: `fluxo-valor ${dir}`, text: $$(val) }),
      ]),
    ]);
    fluxo.onclick = () =>
      filtro === "receita"
        ? abrirLista("Entradas do mês", "t.tipo='receita' AND t.mes=? AND t.ano=?", [estado.mes, estado.ano])
        : abrirLista("Saídas do mês", "t.tipo IN ('despesa','despesa_cartao') AND t.mes=? AND t.ano=?", [estado.mes, estado.ano]);
    dois.append(fluxo);
  }
  resumo.append(dois);
  // Previsto × Realizado no MESMO painel, logo abaixo de Entradas/Saídas.
  if (!ehHistorico) {
    const bp = blocoPrevisto();
    if (bp) resumo.append(bp);
  }
  c.append(resumo);

  // Alertas
  const alertas = calcularAlertas();
  if (alertas.length) {
    const s = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Pendências e alertas" }));
    for (const a of alertas) {
      const b = el("button", { class: "alerta", type: "button" });
      b.append(
        el("span", { class: "alerta-icone" }, svg(ICONES.alerta)),
        el("span", { class: "alerta-txt", text: a.texto }),
        el("span", { class: "contador", text: String(a.n) })
      );
      b.onclick = a.acao;
      s.append(b);
    }
    c.append(s);
  }

  c.append(secaoContas(), secaoCartoes(), secaoMetas(), secaoInvestimentos());
}

/** Bloco Previsto × Realizado (fixas + parcelas provisionadas vs efetivado), para embutir
 *  no painel do topo. Retorna null quando não há plano a comparar. */
function blocoPrevisto() {
  const p = previstoDoMes(estado.mes, estado.ano);
  if (p.entradasPrevisto + p.saidasPrevisto === 0) return null;

  const bloco = el("div", { class: "previsto" }, el("div", { class: "previsto-titulo", text: "Previsto × Realizado" }));

  const pctE = p.entradasPrevisto ? (p.entradasRealizado / p.entradasPrevisto) * 100 : 0;
  bloco.append(barraProporcao(
    "Entradas",
    `${$$(p.entradasRealizado)} de ${$$(p.entradasPrevisto)}`,
    pctE, "var(--receita)", 7,
    () => abrirLista("Entradas do mês", "t.tipo='receita' AND t.mes=? AND t.ano=?", [estado.mes, estado.ano])
  ));

  const pctS = p.saidasPrevisto ? (p.saidasRealizado / p.saidasPrevisto) * 100 : 0;
  bloco.append(barraProporcao(
    "Saídas",
    `${$$(p.saidasRealizado)} de ${$$(p.saidasPrevisto)}` + (p.provisionadas ? ` · ${$$(p.provisionadas)} em parcelas` : ""),
    pctS, "var(--despesa)", 7,
    () => abrirLista("Saídas do mês", "t.tipo IN ('despesa','despesa_cartao') AND t.mes=? AND t.ano=?", [estado.mes, estado.ano])
  ));
  return bloco;
}

function secaoInvestimentos() {
  const invs = bd.todos(
    "SELECT * FROM investimentos WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY COALESCE(valor_atual, valor_aplicado) DESC"
  );
  if (!invs.length) return el("span");

  const total = totalInvestido();
  const s = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Investimentos" }));
  const bloco = el("div", { class: "bloco" });
  for (const inv of invs) {
    const aplicado = aplicadoInvestimento(inv.id);
    const atual = inv.valor_atual ?? aplicado;
    const rendeu = inv.valor_atual != null ? inv.valor_atual - aplicado : 0;
    bloco.append(cardSimples(
      ICONES.grafico, inv.nome,
      inv.instituicao || inv.tipo || "toque para atualizar",
      $$(atual),
      () => formInvestimento(inv)
    ));
    // Se atualizou o valor atual, mostra o rendimento discreto.
    if (rendeu) {
      const ult = bloco.lastChild;
      ult.querySelector(".item-sub").append(
        el("span", { class: rendeu >= 0 ? "up" : "down", style: "margin-left:6px",
          text: `${rendeu >= 0 ? "+" : "−"}${$$(Math.abs(rendeu))}` })
      );
    }
  }
  bloco.append(
    el("div", { class: "total-linha" }, [el("span", { text: "Total" }), el("span", { text: $$(total) })])
  );
  s.append(bloco);
  return s;
}

function secaoContas() {
  const contas = bd.todos("SELECT * FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  const s = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Contas" }));
  const bloco = el("div", { class: "bloco" });

  // Cadastrar/editar conta mora em Mais. Aqui os cards só mostram saldo e abrem os
  // lançamentos ao clicar — a Principal é para ver, não para gerenciar.
  if (!contas.length) {
    bloco.append(
      vazio(ICONES.carteira, "Você ainda não tem contas", "Cadastre em Mais → Contas, ou importe um extrato.",
            "Cadastrar conta", () => telaContas())
    );
  } else {
    for (const conta of contas) {
      bloco.append(cardSimples(
        ICONES.carteira, conta.nome, conta.instituicao, $$(saldoContaNoMes(conta.id, estado.mes, estado.ano)),
        () => abrirLista(conta.nome, "t.conta_id=? AND t.mes=? AND t.ano=?", [conta.id, estado.mes, estado.ano])
      ));
    }
    bloco.append(
      el("div", { class: "total-linha" }, [
        el("span", { text: "Total" }),
        // Soma dos cards (realizado por conta) — a projeção fica no saldo do topo.
        el("span", { text: $$(saldoNoMes(estado.mes, estado.ano)) }),
      ])
    );
  }
  s.append(bloco);
  return s;
}

function secaoCartoes() {
  const cartoes = bd.todos("SELECT * FROM cartoes WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");
  const s = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Cartões de crédito" }));
  const bloco = el("div", { class: "bloco" });

  if (!cartoes.length) {
    bloco.append(
      vazio(ICONES.cartao, "Você ainda não possui cartões", "Cadastre em Mais → Cartões, ou importe uma fatura.",
            "Cadastrar cartão", () => telaCartoes())
    );
  } else {
    for (const cartao of cartoes) {
      const fatura = faturaDoMes(cartao.id, estado.mes, estado.ano);
      const disp = limiteDisponivel(cartao.id, estado.mes, estado.ano);
      bloco.append(cardSimples(
        ICONES.cartao, cartao.nome,
        cartao.limite ? `${$$(disp)} disponível de ${$$(cartao.limite)}` : "sem limite cadastrado",
        $$(fatura),
        () => abrirLista(`${cartao.nome} · fatura`, "t.cartao_id=? AND t.mes=? AND t.ano=?", [cartao.id, estado.mes, estado.ano])
      ));
    }
  }
  s.append(bloco);
  return s;
}

function secaoMetas() {
  const metas = bd.todos(`
    SELECT m.*, COALESCE((SELECT SUM(a.valor) FROM aportes_meta a
                          WHERE a.meta_id = m.id AND a.excluido_em IS NULL), 0) AS guardado
    FROM metas m WHERE m.excluido_em IS NULL AND m.arquivada = 0 ORDER BY m.alvo DESC`);
  if (!metas.length) return el("span");

  const s = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Metas" }));
  const bloco = el("div", { class: "bloco" });
  for (const m of metas) {
    const pct = m.alvo ? Math.min(100, (m.guardado / m.alvo) * 100) : 0;
    // Clicar abre o aporte manual — guardar/resgatar dinheiro na meta.
    const item = el("button", { class: "item", type: "button", style: "display:block" });
    item.append(
      el("div", { style: "display:flex;justify-content:space-between;gap:12px;margin-bottom:6px" }, [
        el("span", { class: "item-nome", text: m.nome }),
        el("span", { class: "item-sub", text: `${$$(m.guardado)} de ${$$(m.alvo)}` }),
      ]),
      el("div", { style: "height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden" },
        el("div", { style: `height:100%;width:${pct}%;background:var(--acao);border-radius:3px` }))
    );
    item.onclick = () => formAporte(m);
    bloco.append(item);
  }
  s.append(bloco);
  return s;
}

/** Guardar/resgatar dinheiro numa meta — o aporte manual pedido. Não move a conta:
 *  a meta é um envelope sobre o saldo (DECISOES.md §7.1). */
function formAporte(meta) {
  const guardado = bd.valor(
    "SELECT COALESCE(SUM(valor),0) FROM aportes_meta WHERE meta_id = ? AND excluido_em IS NULL", [meta.id]
  );
  const falta = Math.max(0, meta.alvo - guardado);

  const valorIn = el("input", { inputmode: "decimal", placeholder: "0,00" });
  const data = el("input", { type: "date", value: iso(hoje) });
  const erro = el("p", { class: "erro" });

  const lancar = (sinal) => {
    erro.textContent = "";
    const v = paraCentavos(valorIn.value);
    if (!v || v <= 0) return (erro.textContent = "Informe um valor maior que zero.");
    if (sinal < 0 && v > guardado) return (erro.textContent = `Você só tem ${$$(guardado)} guardado nesta meta.`);
    const d = data.value || iso(hoje);
    const { mes, ano } = competencia(d);
    const t = bd.agora();
    bd.executar(
      `INSERT INTO aportes_meta (id, meta_id, valor, data, mes, ano, criado_em, atualizado_em, dispositivo)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [bd.uuid(), meta.id, sinal * v, d, mes, ano, t, t, bd.idDispositivo()]
    );
    bd.enfileirar("aportes_meta", meta.id, "insert");
    $("#folha").close();
    render();
  };

  const guardar = el("button", { class: "btn largo", type: "button", text: "Guardar nesta meta" });
  guardar.onclick = () => lancar(1);
  const resgatar = el("button", { class: "btn fantasma largo", type: "button", text: "Resgatar", style: "margin-top:8px" });
  resgatar.onclick = () => lancar(-1);

  const corpo = [
    el("div", { class: "bloco", style: "margin-top:0" }, [
      linhaResumo("Guardado", $$(guardado)),
      linhaResumo("Alvo", $$(meta.alvo)),
      linhaResumo("Falta", $$(falta)),
    ]),
    el("div", { class: "campo valor-grande" }, [el("label", { text: "Valor" }), valorIn]),
    campo("Data", data),
    erro,
    guardar,
  ];
  if (guardado > 0) corpo.push(resgatar);

  // extrato dos aportes desta meta
  const aportes = bd.todos(
    "SELECT * FROM aportes_meta WHERE meta_id = ? AND excluido_em IS NULL ORDER BY data DESC, criado_em DESC",
    [meta.id]
  );
  if (aportes.length) {
    corpo.push(el("h3", { class: "grupo-titulo", text: "Movimentos" }));
    const lista = el("div", { class: "bloco" });
    for (const a of aportes) {
      const linha = el("div", { class: "item", style: "cursor:default" });
      linha.append(
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: a.valor >= 0 ? "Guardado" : "Resgatado" }),
          el("div", { class: "item-sub", text: dataBR(a.data) }),
        ]),
        el("span", { class: "item-valor " + (a.valor >= 0 ? "up" : "down"), text: (a.valor >= 0 ? "+" : "−") + $$(Math.abs(a.valor)) })
      );
      lista.append(linha);
    }
    corpo.push(lista);
  }

  const editar = el("button", { class: "link", type: "button", text: "Editar meta", style: "display:block;margin:14px auto 0" });
  editar.onclick = () => formMeta(meta);
  corpo.push(editar);

  abrirFolha(meta.nome, corpo);
}

function telaTransacoes(c) {
  const linhas = bd.todos(
    `SELECT t.*, c.nome AS categoria_nome FROM transacoes t
     LEFT JOIN categorias c ON c.id = t.categoria_id
     WHERE t.excluido_em IS NULL AND t.mes = ? AND t.ano = ?
     ORDER BY t.data DESC, t.criado_em DESC`,
    [estado.mes, estado.ano]
  );

  const balanco = receitasExibicao(estado.mes, estado.ano) - despesasExibicao(estado.mes, estado.ano);
  const saldo = el("div", { class: "bloco", style: "margin-bottom:20px" },
    el("div", { class: "dois" }, [
      el("div", {}, [
        el("div", { class: "fluxo-rotulo", text: "Saldo no mês" }),
        el("div", { class: "fluxo-valor", text: $$(saldoExibicao(estado.mes, estado.ano)) }),
      ]),
      el("div", {}, [
        el("div", { class: "fluxo-rotulo", text: "Balanço mensal" }),
        el("div", { class: "fluxo-valor " + (balanco >= 0 ? "up" : "down"), text: $$(balanco) }),
      ]),
    ]));
  c.append(saldo);

  if (!linhas.length) {
    c.append(el("div", { class: "bloco" },
      vazio(ICONES.lista, "Ops, você não possui transações registradas",
            "Adicione suas transações para o mês atual usando o botão (+).")));
    return;
  }

  // Auto-classificar pelo aprendizado: aparece quando há itens "a classificar" no mês.
  const nPend = linhas.filter((t) => t.revisar).length;
  if (nPend) {
    const bAuto = el("button", { class: "btn fantasma largo", type: "button",
      text: `Auto-classificar pelo aprendizado (${nPend} a classificar)`, style: "margin-bottom:14px" });
    bAuto.onclick = () => {
      const n = autoClassificar();
      render();
      if (!n) alert("Nada foi classificado ainda. Classifique um lançamento de cada comerciante e depois toque aqui: o app reconhece os demais pela loja.");
    };
    c.append(bAuto);
  }

  const bloco = el("div", { class: "bloco" });
  for (const t of linhas) bloco.append(linhaTransacao(t));
  c.append(bloco);
}

/** Uma linha de transação; clicar abre a edição. */
// `aoVoltar` é chamado depois de salvar/excluir para restaurar de onde a linha veio:
// numa lista modal (abrirLista) reabre a lista atualizada; na aba, não é passado — a aba
// se reconstrói sozinha pelo render(). Sem isto, classificar de dentro de uma lista a
// fechava por inteiro, e parecia que "a lista sumiu".
function linhaTransacao(t, aoVoltar = null) {
  const ehSaida = t.tipo === "despesa" || t.tipo === "despesa_cartao";
  // Reembolso/estorno na fatura entra como despesa de cartão de valor negativo: é um
  // crédito, então mostra como entrada (verde, com +), não como saída de sinal dobrado.
  const credito = ehSaida && t.valor < 0;
  const item = el("button", { class: "item" + (t.revisar ? " a-classificar" : ""), type: "button" });
  item.append(
    el("span", { class: "item-icone" },
      svg(t.tipo === "transferencia" ? '<path d="M4 9h13l-3-3M20 15H7l3 3"/>' : t.tipo === "investimento" ? ICONES.grafico : t.tipo === "despesa_cartao" ? ICONES.cartao : ICONES.carteira)),
    el("div", { class: "item-corpo" }, [
      el("div", { class: "item-nome", text: t.descricao || t.categoria_nome || "—" }),
      el("div", { class: "item-sub", text:
        `${dataBR(t.data)}${t.categoria_nome ? " · " + t.categoria_nome : ""}` +
        (t.parcela_total ? ` · parcela ${t.parcela_num}/${t.parcela_total}` : "") +
        (credito ? " · reembolso" : "") +
        (t.provisorio ? " · provisório" : "") +
        (t.revisar ? " · a classificar" : "") +
        (t.situacao === "pendente" ? " · pendente" : "") }),
    ]),
    el("span", {
      class: "item-valor " + (t.tipo === "receita" || credito ? "up" : ehSaida ? "down" : ""),
      text: (t.tipo === "receita" || credito ? "+" : ehSaida ? "−" : "") + $$(Math.abs(t.valor)),
    })
  );
  item.onclick = () => formEditarTransacao(t, aoVoltar);
  return item;
}

/** Edita/classifica uma transação existente. */
function formEditarTransacao(t, aoVoltar = null) {
  // Depois de salvar: atualiza a aba de fundo e, se veio de uma lista modal, reabre a
  // lista já atualizada em vez de fechar tudo.
  const concluir = () => {
    render();
    if (aoVoltar) aoVoltar();
    else $("#folha").close();
  };
  const doCartao = t.tipo === "despesa_cartao";
  // Valor sempre exibido em módulo; o sinal de reembolso vem do checkbox abaixo.
  const valor = el("input", { inputmode: "decimal", value: brl(Math.abs(t.valor)).replace(/R\$\s*/, "") });
  const desc = el("input", { value: t.descricao ?? "", placeholder: "opcional" });
  const data = el("input", { type: "date", value: t.data });

  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  const cartoes = bd.todos("SELECT id, nome FROM cartoes WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");

  // Os dois conjuntos de categoria (RN-400): despesa e receita são listas independentes.
  // Carrego ambos porque o Tipo pode mudar aqui — classificar uma transferência como
  // "Entrada" precisa mostrar as categorias de receita, que antes não apareciam.
  const catsPorTipo = {
    despesa: bd.todos("SELECT id, nome FROM categorias WHERE excluido_em IS NULL AND ativa = 1 AND tipo = 'despesa' ORDER BY do_sistema, nome"),
    receita: bd.todos("SELECT id, nome FROM categorias WHERE excluido_em IS NULL AND ativa = 1 AND tipo = 'receita' ORDER BY do_sistema, nome"),
  };
  const categoria = el("select");
  const preencherCategorias = () => {
    const lista = tipoSel.value === "receita" ? catsPorTipo.receita : catsPorTipo.despesa;
    const desejado = categoria.value || t.categoria_id;
    categoria.innerHTML = "";
    for (const ct of lista) {
      const o = el("option", { value: ct.id, text: ct.nome });
      if (ct.id === desejado) o.selected = true;
      categoria.append(o);
    }
  };

  // Uma transferência importada pode ser, na verdade, uma entrada (Pix seu de outro
  // banco) — ou um aporte a investimento. Reclassificar aqui resolve os "a classificar".
  const tipoSel = selectDe(
    [
      { valor: "despesa", rotulo: "Saída (despesa)" },
      { valor: "receita", rotulo: "Entrada (receita)" },
      { valor: "transferencia", rotulo: "Transferência (não conta nos totais)" },
      { valor: "investimento", rotulo: "Investimento (aporte — sai da conta)" },
    ],
    doCartao ? "despesa" : t.tipo
  );

  // Investimento de destino, para reclassificar um débito do extrato/cartão como aporte.
  const investimentos = bd.todos("SELECT id, nome FROM investimentos WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");
  const invSel = selectDe(
    [...investimentos.map((i) => ({ id: i.id, nome: i.nome })), { id: NOVO_INVEST, nome: "➕ Novo investimento…" }],
    t.investimento_id ?? investimentos[0]?.id ?? NOVO_INVEST
  );
  const invNome = el("input", { placeholder: "CDB C6, Tesouro, Fundo…" });

  // Conta que a transação toca — o campo que faltava. Sem ele, virar transferência em
  // receita deixava o dinheiro sem conta e ele saía do saldo.
  const contaPadrao = t.conta_id ?? t.conta_destino_id ?? t.conta_origem_id ?? contas[0]?.id;
  const conta = selectDe(contas, contaPadrao);
  const deConta = selectDe(contas, t.conta_origem_id ?? contas[0]?.id);
  const paraDestino = selectDe(
    [...contas.map((c) => ({ id: `c:${c.id}`, nome: c.nome })),
     ...cartoes.map((c) => ({ id: `k:${c.id}`, nome: `${c.nome} (fatura)` }))],
    t.conta_destino_id ? `c:${t.conta_destino_id}` : t.cartao_id ? `k:${t.cartao_id}` : undefined
  );

  // Reembolso/estorno de cartão: crédito na fatura, guardado como valor negativo.
  const reembolso = el("input", { type: "checkbox" });
  if (doCartao && t.valor < 0) reembolso.checked = true;
  const campoReembolso = el("label", { class: "campo", style: "flex-direction:row;align-items:center;gap:10px;cursor:pointer" }, [
    reembolso,
    el("span", { text: "Reembolso / estorno (crédito na fatura)" }),
  ]);

  // Provisório: aguardando conciliação na importação da fatura/extrato.
  const provisorio = el("input", { type: "checkbox" });
  provisorio.checked = !!t.provisorio;
  const campoProvisorio = el("label", { class: "campo", style: "flex-direction:row;align-items:center;gap:10px;cursor:pointer" }, [
    provisorio,
    el("span", { text: "Provisório — concilia na importação da fatura/extrato" }),
  ]);

  const erro = el("p", { class: "erro" });
  const campoCategoria = campo("Categoria", categoria);
  const campoConta = campo("Conta", conta);
  const campoDe = campo("De", deConta);
  const campoPara = campo("Para", paraDestino);
  const campoInvest = campo("Investimento", invSel);
  const campoInvestNovo = campo("Nome do investimento", invNome);

  const alternar = () => {
    const transf = tipoSel.value === "transferencia";
    const invest = tipoSel.value === "investimento";
    // Repovoa a categoria com o conjunto certo (despesa x receita) ao trocar o tipo.
    preencherCategorias();
    // Categoria vale para despesa, receita E cartão — só transferência/investimento não têm.
    campoCategoria.style.display = transf || invest ? "none" : "";
    // Conta: some na transferência (usa De/Para) e no cartão. No investimento é a origem do aporte.
    campoConta.style.display = transf || doCartao ? "none" : "";
    campoDe.style.display = transf ? "" : "none";
    campoPara.style.display = transf ? "" : "none";
    campoInvest.style.display = invest ? "" : "none";
    campoInvestNovo.style.display = invest && invSel.value === NOVO_INVEST ? "" : "none";
    // Reembolso só existe no cartão que segue como saída.
    campoReembolso.style.display = doCartao && tipoSel.value === "despesa" ? "flex" : "none";
    // Provisório vale para os tipos que vêm de fatura/extrato (não transferência/investimento).
    const conciliavel = tipoSel.value === "receita" || tipoSel.value === "despesa";
    campoProvisorio.style.display = (conciliavel || doCartao) && !transf && !invest ? "flex" : "none";
  };
  tipoSel.onchange = alternar;
  invSel.onchange = alternar;

  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar" });
  salvar.onclick = () => {
    erro.textContent = "";
    // Valida pela magnitude: o reembolso é um valor válido, só tem sinal negativo.
    const mag = paraCentavos(valor.value);
    if (!mag || Math.abs(mag) <= 0) return (erro.textContent = "Informe um valor maior que zero.");
    if (!data.value) return (erro.textContent = "Informe a data.");
    const alvo = tipoSel.value;
    // Compra de cartão que continua saída segue na fatura; muda para entrada/transf sai.
    const novoTipo = doCartao && alvo === "despesa" ? "despesa_cartao" : alvo;
    // Reembolso de cartão guarda negativo (crédito reduz a fatura); o resto é positivo.
    const v = novoTipo === "despesa_cartao" && reembolso.checked ? -Math.abs(mag) : Math.abs(mag);
    // Despesa de cartão pertence ao mês em que a fatura é paga, não ao da compra (a data é
    // só da compra). Recalcular pela data a jogaria para outra competência — e ela sumiria
    // da lista da fatura. Só os outros tipos derivam a competência da data.
    const { mes, ano } = novoTipo === "despesa_cartao" ? { mes: t.mes, ano: t.ano } : competencia(data.value);

    // Ajusta os campos de conta conforme o tipo final — é o conserto do bug.
    let contaId = null, origemId = null, destinoId = null, cartaoId = null, catId = null, investId = null;
    if (novoTipo === "despesa_cartao") {
      cartaoId = t.cartao_id;
      catId = categoria.value;
    } else if (alvo === "transferencia") {
      if (`c:${deConta.value}` === paraDestino.value) return (erro.textContent = "Origem e destino são a mesma conta.");
      origemId = deConta.value;
      const [esp, id] = paraDestino.value.split(":");
      destinoId = esp === "c" ? id : null;
      cartaoId = esp === "k" ? id : null;
    } else if (alvo === "investimento") {
      // Reclassificar um débito como aporte: sai da conta (origem) e entra no investimento.
      investId = invSel.value;
      if (investId === NOVO_INVEST) {
        if (!invNome.value.trim()) return (erro.textContent = "Dê um nome ao investimento.");
        investId = bd.uuid();
        const tt = bd.agora();
        bd.executar(
          `INSERT INTO investimentos (id, nome, valor_aplicado, valor_atual, criado_em, atualizado_em, dispositivo)
           VALUES (?,?,0,NULL,?,?,?)`,
          [investId, invNome.value.trim(), tt, tt, bd.idDispositivo()]
        );
        bd.enfileirar("investimentos", investId, "insert");
      }
      origemId = conta.value;
    } else {
      contaId = conta.value;
      catId = categoria.value;
    }

    const prov = (novoTipo === "receita" || novoTipo === "despesa" || novoTipo === "despesa_cartao") && provisorio.checked ? 1 : 0;
    bd.executar(
      `UPDATE transacoes SET tipo=?, valor=?, descricao=?, data=?, mes=?, ano=?,
                             conta_id=?, conta_origem_id=?, conta_destino_id=?, cartao_id=?,
                             categoria_id=?, investimento_id=?, provisorio=?, revisar=0, atualizado_em=? WHERE id=?`,
      [novoTipo, v, desc.value.trim() || null, data.value, mes, ano,
       contaId, origemId, destinoId, cartaoId, catId, investId, prov, bd.agora(), t.id]
    );
    bd.enfileirar("transacoes", t.id, "update");
    // Reclassificar pode mudar a competência (ex.: virar transferência recalcula pela data).
    // A tela acompanha o lançamento para o mês novo, senão ele "some" da lista atual.
    estado.mes = mes;
    estado.ano = ano;
    concluir();
  };

  // Baixa em fixa (RN-651): saída vincula a despesa fixa; entrada, a receita fixa. O botão
  // abre a multi-seleção — pode marcar/desmarcar mais de uma (N×N) e salvar.
  let campoBaixa = null;
  // Investimento também baixa fixa: aporte (saiu da conta) → despesa fixa; resgate → receita.
  const tipoBaixa = t.tipo === "receita" ? "receita"
    : t.tipo === "despesa" || t.tipo === "despesa_cartao" ? "despesa"
    : t.tipo === "investimento" ? (t.conta_destino_id ? "receita" : "despesa")
    : null;
  if (tipoBaixa) {
    const nVinc = bd.valor("SELECT COUNT(*) FROM baixas WHERE transacao_id = ? AND excluido_em IS NULL", [t.id]);
    campoBaixa = el("button", { class: "btn fantasma largo", type: "button", style: "margin-top:8px",
      text: nVinc ? `Vinculado a ${nVinc} fixa${nVinc > 1 ? "s" : ""} · editar` : rotFixa(tipoBaixa).baixaBtn });
    campoBaixa.onclick = () => escolherFixaParaLancamento(t, aoVoltar);
  }

  const excluir = el("button", { class: "btn fantasma largo", type: "button", text: "Excluir", style: "margin-top:8px" });
  excluir.onclick = () => {
    bd.executar("UPDATE transacoes SET excluido_em=?, atualizado_em=? WHERE id=?", [bd.agora(), bd.agora(), t.id]);
    bd.enfileirar("transacoes", t.id, "delete");
    concluir();
  };

  abrirFolha(t.revisar ? "Classificar lançamento" : "Editar lançamento", [
    el("div", { class: "campo valor-grande" }, [el("label", { text: "Valor" }), valor]),
    campo("Data", data),
    campo("Tipo", tipoSel),
    campoCategoria,
    campoReembolso,
    campoConta,
    campoDe,
    campoPara,
    campoInvest,
    campoInvestNovo,
    campo("Descrição", desc),
    campoProvisorio,
    erro,
    salvar,
    campoBaixa,
    excluir,
  ]);
  alternar();
}

/** Lista de transações filtrada — é o que os cards e os totais abrem. */
function abrirLista(titulo, onde, params) {
  const linhas = bd.todos(
    `SELECT t.*, c.nome AS categoria_nome FROM transacoes t
     LEFT JOIN categorias c ON c.id = t.categoria_id
     WHERE t.excluido_em IS NULL AND ${onde}
     ORDER BY t.data DESC, t.criado_em DESC`,
    params
  );
  const corpo = [];
  if (!linhas.length) {
    corpo.push(vazio(ICONES.lista, "Nada aqui neste mês", "Nenhum lançamento com esse filtro."));
  } else {
    const total = linhas.reduce((s, t) => {
      if (t.tipo === "receita") return s + t.valor;
      if (t.tipo === "despesa" || t.tipo === "despesa_cartao") return s - t.valor;
      return s;
    }, 0);
    corpo.push(el("p", { class: "dica", style: "margin-top:0", text:
      `${linhas.length} ${linhas.length === 1 ? "lançamento" : "lançamentos"}` }));
    const bloco = el("div", { class: "bloco" });
    // Ao classificar um item, reabre esta mesma lista atualizada — não fecha tudo.
    const reabrir = () => abrirLista(titulo, onde, params);
    for (const t of linhas) bloco.append(linhaTransacao(t, reabrir));
    corpo.push(bloco);
  }
  abrirFolha(titulo, corpo);
}

const telaEmBreve = (c) =>
  c.append(el("div", { class: "bloco" },
    vazio(ICONES.grafico, "Ainda não construído", "Contas e transações vieram primeiro.")));

/* ---------------- planejamento: despesas e receitas fixas ---------------- */

/* Rótulos por tipo. Despesa e receita usam o MESMO mecanismo (modelo + instância do mês);
   muda só a palavra, o sinal e a cor. */
const ROT_FIXA = {
  despesa: {
    nova: "Nova despesa fixa", cadastrar: "Cadastrar despesa fixa", editarTitulo: "Editar despesa fixa",
    titulo: "Contas fixas a pagar", vazioT: "Nenhuma despesa fixa",
    vazioS: "Cadastre as contas que se repetem todo mês — aluguel, luz, condomínio, financiamento — para acompanhar o que vence e o que já pagou.",
    aberto: "A pagar", feito: "Pagas", atraso: "vencida", jaFeito: "já pago", tudoFeito: "tudo pago",
    acao: "Marcar como paga", desfazer: "Desfazer pagamento", statusFeito: "Paga", statusAberto: "A pagar",
    statusVencida: "Vencida", vencRotulo: "vence", vencCurto: "Vence", feitoVerbo: "pago",
    semLanc: "Marcar paga sem lançamento", semVinc: "Marcar paga sem vincular", pergunta: "pagou",
    tituloBaixa: "Pagar", editar: "Editar modelo da despesa", baixaBtn: "Dar baixa em despesa fixa",
    dicaLanc: "Escolha o lançamento do extrato que pagou esta conta — o valor vem dele, sem contar duas vezes.",
    semFixa: "despesa fixa a pagar", nomeCurto: "despesa fixa", placeholderNome: "Condomínio, Luz, Financiamento…",
    diaLabel: "Dia de vencimento", contaLabel: "Conta de pagamento", ladoLanc: "saídas",
    sinal: "−", cls: "down",
    // Candidatos a baixar uma despesa fixa: saídas E aportes de investimento (ex.: consórcio,
    // que é despesa fixa e vira patrimônio). O aporte tem conta_origem (saiu da conta).
    filtroTipoSql: "(t.tipo IN ('despesa','despesa_cartao') OR (t.tipo='investimento' AND t.conta_origem_id IS NOT NULL))",
  },
  receita: {
    nova: "Nova receita fixa", cadastrar: "Cadastrar receita fixa", editarTitulo: "Editar receita fixa",
    titulo: "Receitas fixas a receber", vazioT: "Nenhuma receita fixa",
    vazioS: "Cadastre entradas que se repetem — salário, aluguel recebido, mensalidade — para acompanhar o que já entrou e o que falta.",
    aberto: "A receber", feito: "Recebidas", atraso: "atrasada", jaFeito: "já recebido", tudoFeito: "tudo recebido",
    acao: "Marcar como recebida", desfazer: "Desfazer recebimento", statusFeito: "Recebida", statusAberto: "A receber",
    statusVencida: "Atrasada", vencRotulo: "prevista", vencCurto: "Prevista", feitoVerbo: "recebido",
    semLanc: "Marcar recebida sem lançamento", semVinc: "Marcar recebida sem vincular", pergunta: "trouxe",
    tituloBaixa: "Receber", editar: "Editar modelo da receita", baixaBtn: "Vincular a receita fixa",
    dicaLanc: "Escolha o lançamento do extrato que trouxe esta entrada — o valor vem dele, sem contar duas vezes.",
    semFixa: "receita fixa a receber", nomeCurto: "receita fixa", placeholderNome: "Salário, Aluguel recebido…",
    diaLabel: "Dia previsto de entrada", contaLabel: "Conta de recebimento", ladoLanc: "entradas",
    sinal: "+", cls: "up",
    // Candidatos a baixar uma receita fixa: entradas E resgates de investimento (voltam pra conta).
    filtroTipoSql: "(t.tipo='receita' OR (t.tipo='investimento' AND t.conta_destino_id IS NOT NULL))",
  },
};
const rotFixa = (tipo) => ROT_FIXA[tipo === "receita" ? "receita" : "despesa"];

/** Aba Planejamento: despesas fixas (a pagar) e receitas fixas (a receber). */
function telaPlanejamento(c) {
  const tipo = estado.planTipo === "receita" ? "receita" : "despesa";
  const R = rotFixa(tipo);

  const abas = el("div", { class: "abas-mini", style: "margin-bottom:12px" });
  for (const [tp, rot] of [["despesa", "Despesas"], ["receita", "Receitas"]]) {
    const bx = el("button", { class: "aba-mini" + (tp === tipo ? " sel" : ""), type: "button", text: rot });
    bx.onclick = () => { estado.planTipo = tp; render(); };
    abas.append(bx);
  }
  c.append(abas);

  const fixas = fixasDoMes(estado.mes, estado.ano, tipo);
  const tot = totalFixas(estado.mes, estado.ano, tipo);

  const resumo = el("section", { class: "resumo" });
  resumo.append(
    el("div", { class: "resumo-rotulo", text: R.titulo }),
    el("div", { class: "resumo-saldo", text: $$(tot.aberto) }),
    el("div", {
      class: "resumo-sub",
      text: tot.qtdAberto
        ? `${tot.qtdAberto} em aberto · ${$$(tot.pago)} ${R.jaFeito} de ${$$(tot.previsto)}`
        : tot.qtd
        ? `${R.tudoFeito} neste mês · ${$$(tot.pago)}`
        : "cadastre suas recorrências",
    })
  );
  c.append(resumo);

  const nova = el("button", { class: "btn largo", type: "button", text: R.nova });
  nova.onclick = () => formFixa(null, tipo);
  c.append(nova);

  if (!fixas.length) {
    c.append(el("div", { class: "bloco", style: "margin-top:14px" }, vazio(ICONES.repetir, R.vazioT, R.vazioS)));
    return;
  }

  const grupos = [
    [tot.qtdVencidas ? `${R.aberto} · ${tot.qtdVencidas} ${R.atraso}${tot.qtdVencidas > 1 ? "s" : ""}` : R.aberto,
      fixas.filter((f) => f.status === "previsto")],
    [R.feito, fixas.filter((f) => f.status === "pago")],
    ["Puladas neste mês", fixas.filter((f) => f.status === "pulado")],
  ];
  for (const [titulo, lista] of grupos) {
    if (!lista.length) continue;
    const s = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: titulo }));
    const bloco = el("div", { class: "bloco" });
    for (const f of lista) bloco.append(linhaFixa(f));
    s.append(bloco);
    c.append(s);
  }
}

function linhaFixa(f) {
  const R = rotFixa(f.tipo);
  const feito = f.status === "pago";
  const item = el("button", { class: "item" + (f.vencida ? " a-classificar" : ""), type: "button" });
  const quando = feito
    ? `${R.feitoVerbo}${f.n_baixas ? ` · ${f.n_baixas} lançament${f.n_baixas > 1 ? "os" : "o"}` : " à mão"}`
    : (f.venc ? `${R.vencRotulo} ${dataBR(f.venc)}` : "sem dia fixo") + (f.vencida ? ` · ${R.atraso}` : "");
  item.append(
    el("span", { class: "item-icone" }, svg(feito ? ICONES.ok : ICONES.repetir)),
    el("div", { class: "item-corpo" }, [
      el("div", { class: "item-nome", text: f.nome }),
      el("div", { class: "item-sub", text: quando + (f.categoria_nome ? " · " + f.categoria_nome : "") }),
    ]),
    el("span", {
      class: "item-valor" + (feito ? " " + R.cls : ""),
      text: (feito ? R.sinal : "") + $$(feito ? f.pago_valor ?? f.valor : f.valor),
    })
  );
  item.onclick = () => formFixaMes(f);
  return item;
}

/** Cadastrar/editar o MODELO de uma fixa (despesa ou receita), a partir do mês atual. */
function formFixa(fixa = null, tipo = null) {
  const tp = fixa ? (fixa.tipo === "receita" ? "receita" : "despesa") : (tipo === "receita" ? "receita" : "despesa");
  const R = rotFixa(tp);
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  const cats = bd.todos(
    "SELECT id, nome FROM categorias WHERE excluido_em IS NULL AND ativa = 1 AND tipo = ? ORDER BY do_sistema, nome", [tp]
  );

  const nome = el("input", { value: fixa?.nome ?? "", placeholder: R.placeholderNome });
  const valorIn = el("input", { inputmode: "decimal", value: fixa?.valor_previsto ? brl(fixa.valor_previsto).replace(/R\$\s*/, "") : "" });
  const dia = el("input", { type: "number", min: "1", max: "31", value: fixa?.dia_vencimento ?? "" });
  const categoria = selectDe([{ id: "", nome: "— sem categoria —" }, ...cats], fixa?.categoria_id ?? "");
  const conta = selectDe([{ id: "", nome: "— não definir —" }, ...contas], fixa?.conta_id ?? "");
  const erro = el("p", { class: "erro" });

  const salvar = el("button", { class: "btn largo", type: "button", text: fixa ? "Salvar" : R.cadastrar });
  salvar.onclick = () => {
    erro.textContent = "";
    if (!nome.value.trim()) return (erro.textContent = "Dê um nome.");
    const v = paraCentavos(valorIn.value);
    if (v == null || v < 0) return (erro.textContent = "Informe o valor previsto.");
    const d = Number(dia.value) || null;
    if (d && (d < 1 || d > 31)) return (erro.textContent = "O dia vai de 1 a 31.");
    const t = bd.agora();
    if (fixa) {
      bd.executar(
        `UPDATE despesas_fixas SET nome=?, valor_previsto=?, dia_vencimento=?, categoria_id=?, conta_id=?, atualizado_em=? WHERE id=?`,
        [nome.value.trim(), v, d, categoria.value || null, conta.value || null, t, fixa.id]
      );
      bd.enfileirar("despesas_fixas", fixa.id, "update");
    } else {
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO despesas_fixas (id, nome, tipo, valor_previsto, dia_vencimento, categoria_id, conta_id,
                                     inicio_mes, inicio_ano, ativa, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
        [id, nome.value.trim(), tp, v, d, categoria.value || null, conta.value || null,
         estado.mes, estado.ano, t, t, bd.idDispositivo()]
      );
      bd.enfileirar("despesas_fixas", id, "insert");
    }
    estado.tela = "planejamento";
    estado.planTipo = tp;
    $("#folha").close();
    render();
  };

  const corpo = [
    campo("Nome", nome),
    campo("Valor previsto (R$)", valorIn, "O valor esperado. A cada mês você pode ajustar para o valor real."),
    campo(R.diaLabel, dia, "Dentro do mês financeiro (25 a 24). Vazio se não tiver dia fixo."),
    campo("Categoria", categoria),
    campo(R.contaLabel, conta),
    erro,
    salvar,
  ];

  if (fixa) {
    const voltar = () => { estado.tela = "planejamento"; estado.planTipo = tp; $("#folha").close(); render(); };
    const encerrar = el("button", { class: "btn fantasma largo", type: "button",
      text: `Encerrar a partir de ${MESES_LONGO[estado.mes - 1]}`, style: "margin-top:8px" });
    encerrar.onclick = () => {
      // fim = mês anterior a este: some daqui pra frente, mas fica no histórico passado.
      let fm = estado.mes - 1, fa = estado.ano;
      if (fm < 1) { fm = 12; fa -= 1; }
      const t = bd.agora();
      bd.executar("UPDATE despesas_fixas SET fim_mes=?, fim_ano=?, atualizado_em=? WHERE id=?", [fm, fa, t, fixa.id]);
      bd.enfileirar("despesas_fixas", fixa.id, "update");
      voltar();
    };
    const excluir = el("button", { class: "link", type: "button", text: "Excluir de vez", style: "display:block;margin:12px auto 0" });
    excluir.onclick = () => {
      const t = bd.agora();
      bd.executar("UPDATE despesas_fixas SET excluido_em=?, atualizado_em=? WHERE id=?", [t, t, fixa.id]);
      bd.executar("UPDATE fixas_mes SET excluido_em=?, atualizado_em=? WHERE fixa_id=? AND excluido_em IS NULL", [t, t, fixa.id]);
      bd.enfileirar("despesas_fixas", fixa.id, "delete");
      voltar();
    };
    corpo.push(encerrar, el("p", { class: "dica", text: "Encerrar mantém os meses passados; excluir apaga a fixa inteira." }), excluir);
  }

  abrirFolha(fixa ? R.editarTitulo : R.nova, corpo);
}

/** Cria ou atualiza a instância de uma fixa num mês (padrão: o mês em tela). */
function upsertFixaMes(f, campos, mes = estado.mes, ano = estado.ano) {
  const t = bd.agora();
  if (f.instancia_id) {
    const sets = Object.keys(campos).map((k) => `${k}=?`).join(", ");
    bd.executar(`UPDATE fixas_mes SET ${sets}, atualizado_em=? WHERE id=?`,
      [...Object.values(campos), t, f.instancia_id]);
    bd.enfileirar("fixas_mes", f.instancia_id, "update");
    return f.instancia_id;
  }
  const cols = Object.keys(campos);
  const id = bd.uuid();
  bd.executar(
    `INSERT INTO fixas_mes (id, fixa_id, mes, ano, ${cols.join(", ")}, criado_em, atualizado_em, dispositivo)
     VALUES (?,?,?,?,${cols.map(() => "?").join(",")},?,?,?)`,
    [id, f.id, mes, ano, ...Object.values(campos), t, t, bd.idDispositivo()]
  );
  bd.enfileirar("fixas_mes", id, "insert");
  f.instancia_id = id;
  return id;
}

/** Garante a instância (fixas_mes) da fixa num mês, criando-a vazia se ainda não existir. */
function garantirInstancia(f, mes = estado.mes, ano = estado.ano) {
  if (f.instancia_id) return f.instancia_id;
  const id = bd.uuid();
  const t = bd.agora();
  bd.executar(
    `INSERT INTO fixas_mes (id, fixa_id, mes, ano, status, criado_em, atualizado_em, dispositivo)
     VALUES (?,?,?,?,'previsto',?,?,?)`,
    [id, f.id, mes, ano, t, t, bd.idDispositivo()]
  );
  bd.enfileirar("fixas_mes", id, "insert");
  f.instancia_id = id;
  return id;
}

/** Lançamentos vinculados a uma fixa do mês (via baixas). */
const lancamentosDaFixa = (fixaMesId) =>
  bd.todos(
    `SELECT b.id AS baixa_id, tx.* FROM baixas b
     JOIN transacoes tx ON tx.id = b.transacao_id AND tx.excluido_em IS NULL
     WHERE b.fixa_mes_id = ? AND b.excluido_em IS NULL
     ORDER BY tx.data DESC`,
    [fixaMesId]
  );

/** Redistribui o valor de um lançamento igualmente entre as fixas a que está vinculado —
 *  compartilhado, não somado. Sobra de centavos vai para os primeiros. */
function redistribuirBaixas(txId) {
  // Se alguma fração foi definida à mão, respeita tudo como está — não reequaliza.
  const temManual = bd.valor("SELECT COUNT(*) FROM baixas WHERE transacao_id = ? AND excluido_em IS NULL AND manual = 1", [txId]);
  if (temManual) return;
  const bxs = bd.todos("SELECT id FROM baixas WHERE transacao_id = ? AND excluido_em IS NULL", [txId]);
  const n = bxs.length;
  if (!n) return;
  const total = Math.abs(bd.valor("SELECT valor FROM transacoes WHERE id = ?", [txId]) ?? 0);
  const base = Math.floor(total / n);
  let resto = total - base * n;
  const t = bd.agora();
  for (const b of bxs) {
    const v = base + (resto > 0 ? 1 : 0);
    if (resto > 0) resto--;
    bd.executar("UPDATE baixas SET valor = ?, atualizado_em = ? WHERE id = ?", [v, t, b.id]);
  }
}

/** Aplica o conjunto de lançamentos vinculados a uma fixa: adiciona os novos, remove os
 *  desmarcados (N×N). Não commita status — quem chama decide. */
function aplicarBaixasNaFixa(fixaMesId, txIds) {
  const atuais = bd.todos("SELECT id, transacao_id FROM baixas WHERE fixa_mes_id = ? AND excluido_em IS NULL", [fixaMesId]);
  const atuaisSet = new Set(atuais.map((a) => a.transacao_id));
  const sel = new Set(txIds);
  const t = bd.agora();
  const disp = bd.idDispositivo();
  const afetados = new Set();
  for (const txId of txIds) {
    if (!atuaisSet.has(txId)) {
      bd.executar("INSERT INTO baixas (id, fixa_mes_id, transacao_id, valor, criado_em, atualizado_em, dispositivo) VALUES (?,?,?,0,?,?,?)",
        [bd.uuid(), fixaMesId, txId, t, t, disp]);
      bd.enfileirar("baixas", fixaMesId, "insert");
      afetados.add(txId);
    }
  }
  for (const a of atuais) {
    if (!sel.has(a.transacao_id)) {
      bd.executar("UPDATE baixas SET excluido_em = ?, atualizado_em = ? WHERE id = ?", [t, t, a.id]);
      bd.enfileirar("baixas", a.id, "delete");
      afetados.add(a.transacao_id);
    }
  }
  // Recalcula a fração de cada lançamento tocado (o que ganhou e o que perdeu um vínculo).
  for (const txId of afetados) redistribuirBaixas(txId);
}

/** Recalcula o status pago/previsto de uma fixa pelo nº de lançamentos vinculados. */
function recalcularStatusFixa(fixaMesId) {
  const n = bd.valor("SELECT COUNT(*) FROM baixas WHERE fixa_mes_id = ? AND excluido_em IS NULL", [fixaMesId]);
  const atual = bd.um("SELECT status FROM fixas_mes WHERE id = ?", [fixaMesId]);
  const t = bd.agora();
  if (n > 0) {
    bd.executar("UPDATE fixas_mes SET status='pago', pago_em=COALESCE(pago_em,?), atualizado_em=? WHERE id=?", [t, t, fixaMesId]);
  } else if (atual?.status === "pago") {
    // Ficou sem vínculo: volta a previsto (só rebaixa o que estava pago).
    bd.executar("UPDATE fixas_mes SET status='previsto', pago_em=NULL, atualizado_em=? WHERE id=?", [t, fixaMesId]);
  }
  bd.enfileirar("fixas_mes", fixaMesId, "update");
}

/** Baixa no sentido inverso (RN-651): a partir de um lançamento do extrato, marcar que
 *  ele pagou/trouxe uma ou mais fixas. Uma saída baixa despesa fixa; uma entrada, receita. */
function escolherFixaParaLancamento(t, aoVoltar = null) {
  // Aporte de investimento baixa despesa fixa; resgate, receita fixa.
  const tipoAlvo = t.tipo === "receita" || (t.tipo === "investimento" && t.conta_destino_id) ? "receita" : "despesa";
  const R = rotFixa(tipoAlvo);
  const total = Math.abs(t.valor);
  // TODAS as fixas ativas do tipo — não só as vigentes na competência do lançamento. Assim
  // dá para vincular mesmo que a fixa tenha começado depois ou o lançamento seja de outro mês.
  const fixas = bd.todos(
    `SELECT f.id, f.nome, f.valor_previsto, f.dia_vencimento,
            fm.id AS instancia_id, fm.valor_ajustado
     FROM despesas_fixas f
     LEFT JOIN fixas_mes fm ON fm.fixa_id = f.id AND fm.mes = ? AND fm.ano = ? AND fm.excluido_em IS NULL
     WHERE f.excluido_em IS NULL AND f.ativa = 1 AND f.tipo = ?
     ORDER BY f.nome`,
    [t.mes, t.ano, tipoAlvo]
  ).map((f) => {
    const v = dataVencimento(t.mes, t.ano, f.dia_vencimento);
    return { ...f, valor: f.valor_ajustado ?? f.valor_previsto, venc: v ? iso(v) : null };
  });
  // Fixas já vinculadas a este lançamento (com a fração guardada) vêm pré-marcadas.
  const vinc = new Map(
    bd.todos("SELECT fixa_mes_id, valor FROM baixas WHERE transacao_id = ? AND excluido_em IS NULL", [t.id])
      .map((r) => [r.fixa_mes_id, r.valor])
  );
  const estados = fixas.map((f) => {
    const ligada = f.instancia_id && vinc.has(f.instancia_id);
    const input = el("input", { inputmode: "decimal", placeholder: "dividir igual",
      value: ligada && vinc.get(f.instancia_id) != null ? brl(vinc.get(f.instancia_id)).replace(/R\$\s*/, "") : "" });
    input.style.width = "110px";
    return { f, checked: !!ligada, input };
  });

  const corpo = [el("p", { class: "dica", style: "margin-top:0", text:
    `Quais ${R.nomeCurto}s este lançamento de ${$$(total)} ${R.pergunta}? Marque uma ou mais, informe o valor de cada (ou deixe em branco para dividir igual) e Salvar.` })];
  if (!fixas.length) {
    corpo.push(vazio(ICONES.repetir, "Nenhuma fixa cadastrada", `Cadastre uma ${R.nomeCurto} em Planejamento para poder vincular.`));
  } else {
    const bloco = el("div", { class: "bloco" });
    for (const st of estados) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = st.checked;
      st.input.style.display = st.checked ? "" : "none";
      cb.onchange = () => { st.checked = cb.checked; st.input.style.display = cb.checked ? "" : "none"; };
      bloco.append(el("label", { class: "item", style: "cursor:pointer" }, [
        cb,
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: st.f.nome }),
          el("div", { class: "item-sub", text:
            (st.f.venc ? R.vencRotulo + " " + dataBR(st.f.venc) : "sem dia fixo") + " · previsto " + $$(st.f.valor) }),
        ]),
        st.input,
      ]));
    }
    corpo.push(bloco);
  }

  const erro = el("p", { class: "erro" });
  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar" });
  salvar.onclick = () => {
    erro.textContent = "";
    const marcadas = estados.filter((s) => s.checked);
    // Lê os valores digitados; o que ficou em branco divide o restante igualmente.
    let somaExplicita = 0;
    let algumExplicito = false;
    const brancos = [];
    const valores = new Map();
    for (const s of marcadas) {
      const raw = s.input.value.trim();
      if (raw) {
        const v = Math.abs(paraCentavos(raw) ?? 0);
        valores.set(s, v);
        somaExplicita += v;
        algumExplicito = true;
      } else {
        brancos.push(s);
      }
    }
    if (somaExplicita > total) return (erro.textContent = `A soma (${$$(somaExplicita)}) passou do lançamento (${$$(total)}).`);
    const resto = Math.max(0, total - somaExplicita);
    if (brancos.length) {
      const base = Math.floor(resto / brancos.length);
      let r = resto - base * brancos.length;
      for (const s of brancos) { const v = base + (r > 0 ? 1 : 0); if (r > 0) r--; valores.set(s, v); }
    }
    const manual = algumExplicito ? 1 : 0;

    const tt = bd.agora();
    const disp = bd.idDispositivo();
    for (const st of estados) {
      const fixaMesId = st.checked ? garantirInstancia(st.f, t.mes, t.ano) : st.f.instancia_id;
      if (!fixaMesId) continue;
      const existe = bd.um("SELECT id FROM baixas WHERE fixa_mes_id=? AND transacao_id=? AND excluido_em IS NULL", [fixaMesId, t.id]);
      if (st.checked) {
        const v = valores.get(st) ?? 0;
        if (existe) bd.executar("UPDATE baixas SET valor=?, manual=?, atualizado_em=? WHERE id=?", [v, manual, tt, existe.id]);
        else bd.executar("INSERT INTO baixas (id, fixa_mes_id, transacao_id, valor, manual, criado_em, atualizado_em, dispositivo) VALUES (?,?,?,?,?,?,?,?)",
          [bd.uuid(), fixaMesId, t.id, v, manual, tt, tt, disp]);
      } else if (existe) {
        bd.executar("UPDATE baixas SET excluido_em=?, atualizado_em=? WHERE id=?", [tt, tt, existe.id]);
      }
      recalcularStatusFixa(fixaMesId);
    }
    // Se foi tudo divisão igual (nenhum valor digitado), deixa o rateio automático cuidar.
    if (!manual) redistribuirBaixas(t.id);
    render();
    if (aoVoltar) aoVoltar();
    else $("#folha").close();
  };
  corpo.push(erro, salvar);
  abrirFolha("Vincular a fixas", corpo);
}

/** Detalhe de uma fixa no mês: ajustar valor, baixar (do extrato) ou pular. */
function formFixaMes(f) {
  const R = rotFixa(f.tipo);
  const feito = f.status === "pago";
  const corpo = [
    el("div", { class: "bloco", style: "margin-top:0" }, [
      linhaResumo("Previsto", $$(f.valor_previsto)),
      f.venc ? linhaResumo(R.vencCurto, dataBR(f.venc)) : null,
      linhaResumo("Situação", feito ? R.statusFeito : f.status === "pulado" ? "Pulada neste mês" : f.vencida ? R.statusVencida : R.statusAberto),
    ].filter(Boolean)),
  ];

  if (feito) {
    const vinculados = f.instancia_id ? lancamentosDaFixa(f.instancia_id) : [];
    const bloco = el("div", { class: "bloco" });
    if (vinculados.length) {
      for (const tx of vinculados) {
        bloco.append(el("div", { class: "item", style: "cursor:default" }, [
          el("span", { class: "item-icone" }, svg(tx.tipo === "despesa_cartao" ? ICONES.cartao : ICONES.carteira)),
          el("div", { class: "item-corpo" }, [
            el("div", { class: "item-nome", text: tx.descricao || "Lançamento" }),
            el("div", { class: "item-sub", text: dataBR(tx.data) }),
          ]),
          el("span", { class: "item-valor " + R.cls, text: R.sinal + $$(Math.abs(tx.valor)) }),
        ]));
      }
      bloco.append(el("div", { class: "total-linha" }, [el("span", { text: "Total baixado" }), el("span", { text: $$(f.pago_valor) })]));
    } else {
      bloco.append(el("div", { class: "item", style: "cursor:default" }, [
        el("span", { class: "item-icone" }, svg(ICONES.ok)),
        el("div", { class: "item-corpo" }, [el("div", { class: "item-nome", text: "Marcada à mão" }),
          el("div", { class: "item-sub", text: "sem lançamento vinculado" })]),
        el("span", { class: "item-valor " + R.cls, text: R.sinal + $$(f.pago_valor) }),
      ]));
    }
    corpo.push(bloco);

    const editarVinc = el("button", { class: "btn largo", type: "button", text: "Editar lançamentos vinculados" });
    editarVinc.onclick = () => escolherLancamentoParaFixa(f);
    const desfazer = el("button", { class: "btn fantasma largo", type: "button", text: R.desfazer, style: "margin-top:8px" });
    desfazer.onclick = () => {
      const t = bd.agora();
      const afet = bd.todos("SELECT transacao_id FROM baixas WHERE fixa_mes_id=? AND excluido_em IS NULL", [f.instancia_id]).map((r) => r.transacao_id);
      bd.executar("UPDATE baixas SET excluido_em=?, atualizado_em=? WHERE fixa_mes_id=? AND excluido_em IS NULL", [t, t, f.instancia_id]);
      bd.executar("UPDATE fixas_mes SET status='previsto', pago_em=NULL, atualizado_em=? WHERE id=?", [t, f.instancia_id]);
      bd.enfileirar("fixas_mes", f.instancia_id, "update");
      for (const id of afet) redistribuirBaixas(id); // as fixas restantes reabsorvem a fração
      $("#folha").close();
      render();
    };
    corpo.push(editarVinc, desfazer);
  } else if (f.status === "pulado") {
    const retomar = el("button", { class: "btn largo", type: "button", text: "Retomar (não pular)" });
    retomar.onclick = () => {
      upsertFixaMes(f, { status: "previsto" });
      $("#folha").close();
      render();
    };
    corpo.push(retomar);
  } else {
    const valorIn = el("input", { inputmode: "decimal", value: brl(f.valor).replace(/R\$\s*/, "") });
    corpo.push(el("div", { class: "campo valor-grande" }, [el("label", { text: "Valor deste mês" }), valorIn]));

    const pagar = el("button", { class: "btn largo", type: "button", text: R.acao });
    pagar.onclick = () => {
      // Salva o valor digitado antes de escolher o lançamento, para não perder o ajuste.
      const v = paraCentavos(valorIn.value);
      if (v && v > 0 && v !== f.valor) upsertFixaMes(f, { valor_ajustado: v });
      escolherLancamentoParaFixa(f);
    };
    const salvarValor = el("button", { class: "btn fantasma largo", type: "button", text: "Salvar valor do mês" });
    salvarValor.onclick = () => {
      const v = paraCentavos(valorIn.value);
      if (!v || v <= 0) return;
      upsertFixaMes(f, { valor_ajustado: v });
      $("#folha").close();
      render();
    };
    const pular = el("button", { class: "link", type: "button", text: "Pular este mês", style: "display:block;margin:12px auto 0" });
    pular.onclick = () => {
      upsertFixaMes(f, { status: "pulado" });
      $("#folha").close();
      render();
    };
    corpo.push(pagar, salvarValor, pular);
  }

  const editar = el("button", { class: "link", type: "button", text: R.editar, style: "display:block;margin:14px auto 0" });
  editar.onclick = () => formFixa(f);
  corpo.push(editar);

  abrirFolha(f.nome, corpo);
}

/** Escolher os lançamentos que baixam a fixa (multi-seleção, N×N). Só grava no Salvar. */
function escolherLancamentoParaFixa(f) {
  const R = rotFixa(f.tipo);
  const fixaMesId = f.instancia_id;
  const jaVinc = new Set(
    fixaMesId
      ? bd.todos("SELECT transacao_id FROM baixas WHERE fixa_mes_id=? AND excluido_em IS NULL", [fixaMesId]).map((r) => r.transacao_id)
      : []
  );
  // Candidatos: TODAS as transações do tipo (extrato, cartão e aportes de investimento) no
  // mês — categorizadas ou não. Você escolhe quais vincular; as já vinculadas vêm marcadas.
  const cands = bd.todos(
    `SELECT t.*, c.nome AS categoria_nome FROM transacoes t
     LEFT JOIN categorias c ON c.id = t.categoria_id
     WHERE t.excluido_em IS NULL AND ${R.filtroTipoSql} AND t.mes = ? AND t.ano = ?
     ORDER BY t.data DESC`,
    [estado.mes, estado.ano]
  );
  cands.sort((a, b) => Math.abs(a.valor - f.valor) - Math.abs(b.valor - f.valor));
  const selec = new Set(jaVinc);

  const gravar = (status) => {
    const id = garantirInstancia(f);
    aplicarBaixasNaFixa(id, [...selec]);
    const t = bd.agora();
    const pago = status === "pago" || selec.size > 0;
    bd.executar("UPDATE fixas_mes SET status=?, pago_em=?, atualizado_em=? WHERE id=?",
      [pago ? "pago" : "previsto", pago ? t : null, t, id]);
    bd.enfileirar("fixas_mes", id, "update");
    $("#folha").close();
    render();
  };

  const corpo = [el("p", { class: "dica", style: "margin-top:0", text: R.dicaLanc + " Marque uma ou mais e toque em Salvar." })];
  if (!cands.length) {
    corpo.push(vazio(ICONES.lista, "Nenhum lançamento neste mês",
      `Não há ${R.ladoLanc} neste mês. Importe o extrato/fatura, ou marque mesmo assim.`));
    const semLanc = el("button", { class: "btn largo", type: "button", text: R.semLanc });
    semLanc.onclick = () => gravar("pago");
    corpo.push(semLanc);
  } else {
    const bloco = el("div", { class: "bloco" });
    for (const tx of cands) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = selec.has(tx.id);
      cb.onchange = () => { cb.checked ? selec.add(tx.id) : selec.delete(tx.id); };
      bloco.append(el("label", { class: "item", style: "cursor:pointer" }, [
        cb,
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: tx.descricao || tx.categoria_nome || "—" }),
          el("div", { class: "item-sub", text: dataBR(tx.data) + (tx.categoria_nome ? " · " + tx.categoria_nome : "") + (tx.valor === f.valor ? " · valor igual ao previsto" : "") }),
        ]),
        el("span", { class: "item-valor " + R.cls, text: R.sinal + $$(Math.abs(tx.valor)) }),
      ]));
    }
    corpo.push(bloco);
    const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar" });
    salvar.onclick = () => gravar();
    corpo.push(salvar);
    const semLanc = el("button", { class: "link", type: "button", text: R.semLanc, style: "display:block;margin:12px auto 0" });
    semLanc.onclick = () => gravar("pago");
    corpo.push(semLanc);
  }
  abrirFolha(`${R.tituloBaixa} ${f.nome}`, corpo);
}

/* ---------------- painel / dashboards ---------------- */

function barraProporcao(rotulo, valorTexto, pct, cor, alturaBarras = 10, aoClicar = null) {
  const conteudo = [
    el("div", { style: "display:flex;justify-content:space-between;gap:10px;margin-bottom:4px" }, [
      el("span", { class: "item-nome", text: rotulo + (aoClicar ? " ›" : "") }),
      el("span", { class: "item-sub", text: valorTexto }),
    ]),
    el("div", { style: `height:${alturaBarras}px;background:var(--surface-2);border-radius:6px;overflow:hidden` },
      el("div", { style: `height:100%;width:${Math.max(1, Math.min(100, pct))}%;background:${cor};border-radius:6px` })),
  ];
  if (!aoClicar) return el("div", { style: "margin:10px 0" }, conteudo);
  // Clicável: abre os lançamentos que compõem a barra.
  const b = el("button", { type: "button", style: "display:block;width:100%;text-align:left;background:none;border:none;padding:0;margin:10px 0;cursor:pointer" }, conteudo);
  b.onclick = aoClicar;
  return b;
}

/** Painel: gastos por categoria, receita x despesa, evolução do saldo e metas. */
function telaDashboard(c) {
  const mes = estado.mes;
  const ano = estado.ano;


  // 1. Receitas x Despesas do mês (usa o histórico manual, se o mês for de referência)
  const rec = receitasExibicao(mes, ano);
  const desp = despesasExibicao(mes, ano);
  const maxRD = Math.max(rec, desp, 1);
  const secRD = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Receitas x Despesas" }));
  const blocoRD = el("div", { class: "bloco" }, [
    barraProporcao("Receitas", $$(rec), (rec / maxRD) * 100, "var(--receita)", 10,
      () => abrirLista("Entradas do mês", "t.tipo='receita' AND t.mes=? AND t.ano=?", [mes, ano])),
    barraProporcao("Despesas", $$(desp), (desp / maxRD) * 100, "var(--despesa)", 10,
      () => abrirLista("Saídas do mês", "t.tipo IN ('despesa','despesa_cartao') AND t.mes=? AND t.ano=?", [mes, ano])),
  ]);
  const bal = rec - desp;
  blocoRD.append(el("div", { class: "total-linha" }, [
    el("span", { text: "Balanço" }),
    el("span", { class: bal >= 0 ? "up" : "down", text: (bal >= 0 ? "+" : "−") + $$(Math.abs(bal)) }),
  ]));
  secRD.append(blocoRD);
  c.append(secRD);

  // 2. Gastos por categoria
  const cats = bd.todos(
    `SELECT c.id AS cid, COALESCE(c.nome, 'Outros') AS nome, SUM(t.valor) AS total
     FROM transacoes t LEFT JOIN categorias c ON c.id = t.categoria_id
     WHERE t.excluido_em IS NULL AND t.tipo IN ('despesa','despesa_cartao') AND t.situacao = 'efetivada'
       AND t.mes = ? AND t.ano = ?
     GROUP BY c.id HAVING total > 0 ORDER BY total DESC`,
    [mes, ano]
  );
  const totalCat = cats.reduce((s, x) => s + x.total, 0);
  const secCat = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Gastos por categoria" }));
  const blocoCat = el("div", { class: "bloco" });
  if (!cats.length) {
    blocoCat.append(el("p", { class: "dica", style: "text-align:center;margin:6px 0", text: "Sem despesas neste mês." }));
  } else {
    cats.forEach((x, i) => {
      const pct = totalCat ? (x.total / totalCat) * 100 : 0;
      // Clicar mostra os lançamentos somados naquela categoria.
      const filtro = x.cid
        ? "t.tipo IN ('despesa','despesa_cartao') AND t.categoria_id=? AND t.mes=? AND t.ano=?"
        : "t.tipo IN ('despesa','despesa_cartao') AND t.categoria_id IS NULL AND t.mes=? AND t.ano=?";
      const params = x.cid ? [x.cid, mes, ano] : [mes, ano];
      blocoCat.append(barraProporcao(x.nome, `${Math.round(pct)}% · ${$$(x.total)}`, pct, CORES_GRAF[i % CORES_GRAF.length], 8,
        () => abrirLista(`${x.nome} · ${MESES_LONGO[mes - 1]} ${ano}`, filtro, params)));
    });
    blocoCat.append(el("div", { class: "total-linha" }, [el("span", { text: "Total" }), el("span", { text: $$(totalCat) })]));
  }
  secCat.append(blocoCat);
  c.append(secCat);

  // 3. Evolução do saldo — últimos 6 meses
  const serie = [];
  for (let k = 5; k >= 0; k--) {
    let m = mes - k, y = ano;
    while (m < 1) { m += 12; y -= 1; }
    serie.push({ m, y, v: saldoExibicao(m, y) });
  }
  const maxAbs = Math.max(...serie.map((s) => Math.abs(s.v)), 1);
  const secEv = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Evolução do saldo" }));
  const grade = el("div", { style: "display:flex;align-items:flex-end;gap:8px;height:120px;padding:8px 4px" });
  for (const s of serie) {
    const h = Math.round((Math.abs(s.v) / maxAbs) * 100);
    const col = el("div", { style: "flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end", title: `${MESES[s.m - 1]}: ${brl(s.v)}` }, [
      el("div", { style: `width:72%;height:${h}%;min-height:2px;border-radius:5px 5px 0 0;background:${s.v >= 0 ? "var(--receita)" : "var(--despesa)"}` }),
      el("div", { class: "dica", style: "font-size:10px", text: MESES[s.m - 1] }),
    ]);
    grade.append(col);
  }
  const blocoEv = el("div", { class: "bloco" }, [
    grade,
    el("div", { class: "total-linha" }, [el("span", { text: `${MESES_LONGO[mes - 1]} ${ano}` }), el("span", { text: $$(serie[serie.length - 1].v) })]),
  ]);
  secEv.append(blocoEv);
  c.append(secEv);

  // 4. Metas — barra de atingimento
  const metas = bd.todos(`
    SELECT m.*, COALESCE((SELECT SUM(a.valor) FROM aportes_meta a
                          WHERE a.meta_id = m.id AND a.excluido_em IS NULL), 0) AS guardado
    FROM metas m WHERE m.excluido_em IS NULL AND m.arquivada = 0 ORDER BY m.alvo DESC`);
  if (metas.length) {
    const secM = el("section", { class: "secao" }, el("h2", { class: "secao-titulo", text: "Metas" }));
    const blocoM = el("div", { class: "bloco" });
    for (const m of metas) {
      const pct = m.alvo ? Math.min(100, (m.guardado / m.alvo) * 100) : 0;
      blocoM.append(barraProporcao(m.nome, `${Math.round(pct)}% · ${$$(m.guardado)} de ${$$(m.alvo)}`, pct, "var(--acao)", 8));
    }
    secM.append(blocoM);
    c.append(secM);
  }
}

/** Backup: baixar tudo num arquivo e restaurar depois. É o que protege de limpar o cache. */
function telaBackup() {
  const corpo = [];
  corpo.push(el("p", { class: "dica", style: "margin-top:0", text:
    "Seus dados ficam só neste navegador. Limpar os dados do site apaga tudo — baixe um backup de vez em quando e guarde no Drive ou no e-mail." }));

  const stats = [
    ["Contas", bd.valor("SELECT COUNT(*) FROM contas WHERE excluido_em IS NULL")],
    ["Lançamentos", bd.valor("SELECT COUNT(*) FROM transacoes WHERE excluido_em IS NULL")],
    ["Fixas", bd.valor("SELECT COUNT(*) FROM despesas_fixas WHERE excluido_em IS NULL")],
  ];
  const resumo = el("div", { class: "bloco" });
  for (const [r, n] of stats) resumo.append(linhaResumo(r, String(n ?? 0)));
  corpo.push(resumo);

  const baixar = el("button", { class: "btn largo", type: "button", text: "Baixar backup agora" });
  baixar.onclick = () => {
    try {
      const bytes = bd.exportarBytes();
      const blob = new Blob([bytes], { type: "application/x-sqlite3" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `financas-backup-${iso(new Date())}.sqlite` });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Não consegui gerar o backup: " + e.message);
    }
  };
  corpo.push(baixar);

  const restaurar = el("button", { class: "btn fantasma largo", type: "button", text: "Restaurar de um arquivo", style: "margin-top:8px" });
  restaurar.onclick = () => {
    const inp = el("input", { type: "file", accept: ".sqlite,application/x-sqlite3" });
    inp.style.display = "none";
    document.body.append(inp);
    inp.onchange = async () => {
      const f = inp.files?.[0];
      inp.remove();
      if (!f) return;
      if (!confirm("Restaurar vai SUBSTITUIR os dados atuais deste navegador pelos do arquivo. Continuar?")) return;
      try {
        await bd.importarBytes(new Uint8Array(await f.arrayBuffer()));
        location.reload();
      } catch (e) {
        alert("Não consegui restaurar: " + e.message);
      }
    };
    inp.click();
  };
  corpo.push(restaurar);
  corpo.push(el("p", { class: "dica", text:
    "Para levar seus dados a outro aparelho: baixe o backup aqui e restaure-o lá." }));

  // ---- Backup na nuvem (GitHub)
  corpo.push(el("h3", { class: "grupo-titulo", text: "Backup na nuvem (GitHub)" }));
  const n = nuvem.info();
  if (!n.configurado) {
    const token = el("input", { type: "password", placeholder: "github_pat_… ou ghp_…", autocomplete: "off" });
    const repo = el("input", { placeholder: "usuario/financas-backup" });
    const branch = el("input", { value: "main" });
    const path = el("input", { value: "financas.sqlite" });
    const validade = el("input", { type: "number", min: "1", value: "90" });
    const erroN = el("p", { class: "erro" });
    const conectar = el("button", { class: "btn largo", type: "button", text: "Conectar e enviar" });
    conectar.onclick = async () => {
      erroN.textContent = "";
      if (!token.value.trim() || !repo.value.trim()) return (erroN.textContent = "Informe o token e o repositório.");
      nuvem.configurar({ token: token.value, repo: repo.value, branch: branch.value, path: path.value, validadeDias: validade.value });
      conectar.disabled = true;
      conectar.textContent = "Conectando…";
      try {
        await nuvem.enviar(bd.exportarBytes());
        statusNuvem = "enviado";
        pintarNuvem();
        telaBackup();
      } catch (e) {
        nuvem.desconectar();
        erroN.textContent = e.message;
        conectar.disabled = false;
        conectar.textContent = "Conectar e enviar";
      }
    };
    corpo.push(
      el("p", { class: "dica", style: "margin-top:0", text:
        "Crie um repositório privado e um token fine-grained com acesso só a ele (Contents: Read and write). O token fica salvo só neste navegador — nunca vai dentro do backup." }),
      campo("Token de acesso", token),
      campo("Repositório", repo, "no formato usuario/repositorio"),
      campo("Branch", branch),
      campo("Arquivo", path),
      campo("Validade do token (dias)", validade, "Para eu te avisar de renovar. O padrão do GitHub é 90 dias."),
      erroN,
      conectar
    );
  } else {
    const dias = nuvem.diasParaExpirar();
    const resumo = el("div", { class: "bloco" }, [
      linhaResumo("Repositório", n.repo),
      linhaResumo("Último envio", n.ultimo ? dataHoraBR(n.ultimo) : "ainda não enviou"),
      dias != null ? linhaResumo("Token", dias < 0 ? "expirado — renove" : `expira em ${dias} dia(s)`) : null,
    ].filter(Boolean));
    corpo.push(resumo, el("p", { class: "dica", style: "margin-top:0", text:
      "O envio é automático depois de mudanças. Aqui você pode forçar agora ou restaurar a versão da nuvem." }));
    if (dias != null && dias <= 10) {
      corpo.push(el("p", { class: "dica", text:
        "Para renovar: gere um novo token fine-grained no GitHub, toque em Desconectar e conecte de novo com o token novo." }));
    }

    const enviarAgora = el("button", { class: "btn largo", type: "button", text: "Enviar backup agora" });
    enviarAgora.onclick = async () => {
      enviarAgora.disabled = true;
      enviarAgora.textContent = "Enviando…";
      const ok = await enviarNuvem();
      if (ok) telaBackup();
      else {
        enviarAgora.disabled = false;
        enviarAgora.textContent = "Enviar backup agora";
      }
    };
    const restaurarNuvem = el("button", { class: "btn fantasma largo", type: "button", text: "Restaurar da nuvem", style: "margin-top:8px" });
    restaurarNuvem.onclick = async () => {
      if (!confirm("Restaurar vai SUBSTITUIR os dados deste navegador pelo backup da nuvem. Continuar?")) return;
      try {
        await bd.importarBytes(await nuvem.baixar());
        location.reload();
      } catch (e) {
        alert("Não consegui restaurar: " + e.message);
      }
    };
    const desconectar = el("button", { class: "link", type: "button", text: "Desconectar", style: "display:block;margin:12px auto 0" });
    desconectar.onclick = () => { nuvem.desconectar(); statusNuvem = "ocioso"; pintarNuvem(); telaBackup(); };
    corpo.push(enviarAgora, restaurarNuvem, desconectar);
  }

  abrirFolha("Backup e restauração", corpo);
}

/** Histórico dos meses anteriores (Jan–Jun): totais fixos de referência. Ao salvar,
 *  desconsidera (exclui) os lançamentos anteriores a julho. */
function formHistoricoMensal() {
  const ANO = 2026;
  const linhas = [1, 2, 3, 4, 5, 6].map((m) => {
    const h = bd.um("SELECT * FROM historico_mensal WHERE mes=? AND ano=?", [m, ANO]);
    const semRS = (v) => (v != null ? brl(v).replace(/R\$\s*/, "") : "");
    return {
      m,
      ent: el("input", { inputmode: "decimal", placeholder: "0,00", value: h ? semRS(h.entradas) : "" }),
      sai: el("input", { inputmode: "decimal", placeholder: "0,00", value: h ? semRS(h.saidas) : "" }),
      sal: el("input", { inputmode: "decimal", placeholder: "0,00", value: h ? semRS(h.saldo) : "" }),
    };
  });

  const corpo = [el("p", { class: "dica", style: "margin-top:0", text:
    "Informe os totais fechados de cada mês (Jan–Jun/2026). Servem só de referência no painel. " +
    "Ao salvar, os lançamentos anteriores a julho são desconsiderados." })];
  for (const L of linhas) {
    corpo.push(el("h3", { class: "grupo-titulo", text: `${MESES_LONGO[L.m - 1]} / ${ANO}` }));
    const linha = el("div", { class: "bloco", style: "margin-top:0" }, [
      campo("Entradas (R$)", L.ent),
      campo("Saídas (R$)", L.sai),
      campo("Saldo no fim do mês (R$)", L.sal),
    ]);
    corpo.push(linha);
  }

  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar histórico" });
  salvar.onclick = () => {
    const t = bd.agora();
    const disp = bd.idDispositivo();
    for (const L of linhas) {
      const preenchido = L.ent.value.trim() || L.sai.value.trim() || L.sal.value.trim();
      const ex = bd.um("SELECT id FROM historico_mensal WHERE mes=? AND ano=?", [L.m, ANO]);
      if (!preenchido) {
        if (ex) bd.executar("DELETE FROM historico_mensal WHERE id=?", [ex.id]);
        continue;
      }
      const ent = paraCentavos(L.ent.value) ?? 0;
      const sai = paraCentavos(L.sai.value) ?? 0;
      const sal = L.sal.value.trim() ? paraCentavos(L.sal.value) : null;
      if (ex) bd.executar("UPDATE historico_mensal SET entradas=?, saidas=?, saldo=?, atualizado_em=? WHERE id=?", [ent, sai, sal, t, ex.id]);
      else bd.executar("INSERT INTO historico_mensal (id,mes,ano,entradas,saidas,saldo,criado_em,atualizado_em,dispositivo) VALUES (?,?,?,?,?,?,?,?,?)",
        [bd.uuid(), L.m, ANO, ent, sai, sal, t, t, disp]);
    }
    // Desconsidera tudo antes de Julho/2026 (o histórico da planilha e afins).
    bd.executar("UPDATE transacoes SET excluido_em=?, atualizado_em=? WHERE excluido_em IS NULL AND (ano*12+mes) < ?", [t, t, ANO * 12 + 7]);
    bd.definirConfig("historico_manual", "1");
    $("#folha").close();
    render();
  };
  corpo.push(salvar);
  abrirFolha("Histórico dos meses (Jan–Jun)", corpo);
}

function telaMais(c) {
  const bloco = el("div", { class: "bloco" });
  const nCat = bd.valor("SELECT COUNT(*) FROM categorias WHERE excluido_em IS NULL");
  const nConta = bd.valor("SELECT COUNT(*) FROM contas WHERE excluido_em IS NULL");
  const nCartao = bd.valor("SELECT COUNT(*) FROM cartoes WHERE excluido_em IS NULL");
  const nMeta = bd.valor("SELECT COUNT(*) FROM metas WHERE excluido_em IS NULL");
  const nInv = bd.valor("SELECT COUNT(*) FROM investimentos WHERE excluido_em IS NULL");
  const opcoes = [
    ["Contas", nConta ? `${nConta} cadastrada${nConta > 1 ? "s" : ""}` : "nenhuma ainda", () => telaContas()],
    ["Cartões", nCartao ? `${nCartao} cadastrado${nCartao > 1 ? "s" : ""}` : "nenhum ainda", () => telaCartoes()],
    ["Categorias", `${nCat} cadastradas`, () => telaCategorias()],
    ["Metas", nMeta ? `${nMeta} meta${nMeta > 1 ? "s" : ""}` : "reservar dinheiro", () => telaMetas()],
    ["Investimentos", nInv ? `${nInv} aplicaç${nInv > 1 ? "ões" : "ão"}` : "patrimônio aplicado", () => telaInvestimentos()],
    ["Importar fatura ou extrato", "PDF (fatura) ou OFX/PDF (extrato)", () => abrirImportacao()],
    ["Histórico dos meses (Jan–Jun)", "valores fixos de referência", () => formHistoricoMensal()],
    ["Backup e restauração", "salvar seus dados num arquivo", () => telaBackup()],
    ["Tema claro / escuro", "", () => alternarTema()],
  ];
  for (const [nome, sub, acao] of opcoes) {
    const b = el("button", { class: "item", type: "button" });
    b.append(
      el("div", { class: "item-corpo" }, [
        el("div", { class: "item-nome", text: nome }),
        sub ? el("div", { class: "item-sub", text: sub }) : null,
      ])
    );
    b.onclick = acao;
    bloco.append(b);
  }
  c.append(bloco);
}

/** Gerenciar contas: lista + adicionar + editar. Vive em Mais. */
function telaContas() {
  const contas = bd.todos("SELECT * FROM contas WHERE excluido_em IS NULL ORDER BY arquivada, nome");
  const corpo = [];
  const nova = el("button", { class: "btn largo", type: "button", text: "Adicionar conta" });
  nova.onclick = () => formConta();
  corpo.push(nova);

  if (!contas.length) {
    corpo.push(el("p", { class: "dica", style: "text-align:center;margin-top:16px", text:
      "Nenhuma conta ainda. Adicione acima, ou importe um extrato — o PDF cria a conta sozinho." }));
  } else {
    const bloco = el("div", { class: "bloco", style: "margin-top:14px" });
    for (const c of contas) {
      const item = el("button", { class: "item", type: "button" });
      item.append(
        el("span", { class: "item-icone" }, svg(ICONES.carteira)),
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: c.nome + (c.arquivada ? " · arquivada" : "") }),
          el("div", { class: "item-sub", text: c.instituicao || "toque para editar" }),
        ]),
        el("span", { class: "item-valor", text: $$(saldoConta(c.id)) })
      );
      item.onclick = () => formConta(c);
      bloco.append(item);
    }
    corpo.push(bloco);
  }
  abrirFolha("Contas", corpo);
}

/** Gerenciar cartões. Vive em Mais. */
function telaCartoes() {
  const cartoes = bd.todos("SELECT * FROM cartoes WHERE excluido_em IS NULL ORDER BY arquivado, nome");
  const corpo = [];
  const novo = el("button", { class: "btn largo", type: "button", text: "Adicionar cartão" });
  novo.onclick = () => formCartao();
  corpo.push(novo);

  if (!cartoes.length) {
    corpo.push(el("p", { class: "dica", style: "text-align:center;margin-top:16px", text:
      "Nenhum cartão ainda. Adicione acima, ou importe uma fatura — o PDF traz limite, fechamento e vencimento." }));
  } else {
    const bloco = el("div", { class: "bloco", style: "margin-top:14px" });
    for (const c of cartoes) {
      const item = el("button", { class: "item", type: "button" });
      item.append(
        el("span", { class: "item-icone" }, svg(ICONES.cartao)),
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: c.nome + (c.arquivado ? " · arquivado" : "") }),
          el("div", { class: "item-sub", text:
            c.limite ? `limite ${$$(c.limite)} · fecha ${c.dia_fechamento ?? "?"} · vence ${c.dia_vencimento ?? "?"}` : "toque para editar" }),
        ])
      );
      item.onclick = () => formCartao(c);
      bloco.append(item);
    }
    corpo.push(bloco);
  }
  abrirFolha("Cartões", corpo);
}

function telaCategorias(tipo = "despesa") {
  const grupos = bd.todos("SELECT id, nome FROM grupos_categoria WHERE excluido_em IS NULL ORDER BY ordem");
  const cats = bd.todos(
    `SELECT c.*, g.nome AS grupo_nome,
            (SELECT COUNT(*) FROM transacoes t WHERE t.categoria_id = c.id AND t.excluido_em IS NULL) AS usos
     FROM categorias c LEFT JOIN grupos_categoria g ON g.id = c.grupo_id
     WHERE c.excluido_em IS NULL AND c.tipo = ? ORDER BY g.ordem, c.do_sistema, c.nome`,
    [tipo]
  );

  const corpo = [];

  // Abas Despesas / Receitas (RN-400)
  const abas = el("div", { class: "abas-mini" });
  for (const [t, r] of [["despesa", "Despesas"], ["receita", "Receitas"]]) {
    const b = el("button", { class: "aba-mini" + (t === tipo ? " sel" : ""), type: "button", text: r });
    b.onclick = () => telaCategorias(t);
    abas.append(b);
  }
  corpo.push(abas);

  const nova = el("button", { class: "btn largo", type: "button", text: "Nova categoria" });
  nova.onclick = () => formCategoria(null, tipo);
  corpo.push(nova);

  // Agrupadas por grupo (RN-412)
  const porGrupo = new Map();
  for (const c of cats) {
    const g = c.grupo_nome || "Sem grupo";
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(c);
  }
  for (const [grupo, lista] of porGrupo) {
    corpo.push(el("h3", { class: "grupo-titulo", text: grupo }));
    const bloco = el("div", { class: "bloco" });
    for (const c of lista) {
      const item = el("button", { class: "item", type: "button" });
      item.append(
        el("span", { class: "item-icone", style: "font-size:18px", text: c.icone || "•" }),
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: c.nome + (c.do_sistema ? " · sistema" : "") }),
          el("div", { class: "item-sub", text: c.usos ? `${c.usos} lançamentos` : "sem uso" }),
        ])
      );
      item.onclick = () => formCategoria(c, tipo);
      bloco.append(item);
    }
    corpo.push(bloco);
  }

  abrirFolha("Categorias", corpo);
}

// Um seletor visível de emojis, porque no computador o campo de texto não oferece
// nenhum — "não carrega emojis" era isto. O campo de texto continua, para quem quiser
// colar outro.
const EMOJIS_CATEGORIA = [
  "🛒", "🍽️", "🏠", "🩺", "🚗", "💡", "🎭", "👗", "💅", "📚", "🐾", "💊",
  "📈", "🏛️", "🏦", "🛡️", "🔨", "💼", "📣", "⛪", "🎁", "🏝️", "📺", "✈️",
  "☕", "🍺", "💇", "🏋️", "⚽", "🎮", "📱", "🧾", "💰", "🎓", "🚿", "🧹",
];

function formCategoria(cat, tipo) {
  const nome = el("input", { value: cat?.nome ?? "", placeholder: "Mercado" });
  const icone = el("input", { value: cat?.icone ?? "", placeholder: "🛒", maxlength: "4", inputmode: "text" });
  const grupos = bd.todos("SELECT id, nome FROM grupos_categoria WHERE excluido_em IS NULL ORDER BY ordem");
  const grupoSel = selectDe([{ id: "", nome: "— sem grupo —" }, ...grupos], cat?.grupo_id ?? "");
  const erro = el("p", { class: "erro" });

  // Grade tocável de emojis: o toque preenche o campo e destaca o escolhido.
  const grade = el("div", { class: "emoji-grade" });
  const marcar = () => {
    grade.querySelectorAll(".emoji-op").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.textContent === icone.value.trim()))
    );
  };
  for (const e of EMOJIS_CATEGORIA) {
    const b = el("button", { class: "emoji-op", type: "button", text: e });
    b.onclick = () => {
      icone.value = e;
      marcar();
    };
    grade.append(b);
  }
  icone.oninput = marcar;

  const salvar = el("button", { class: "btn largo", type: "button", text: cat ? "Salvar" : "Criar categoria" });
  salvar.onclick = () => {
    erro.textContent = "";
    if (!nome.value.trim()) return (erro.textContent = "Dê um nome à categoria.");
    const t = bd.agora();
    if (cat) {
      bd.executar("UPDATE categorias SET nome=?, icone=?, grupo_id=?, atualizado_em=? WHERE id=?",
        [nome.value.trim(), icone.value.trim() || null, grupoSel.value || null, t, cat.id]);
      bd.enfileirar("categorias", cat.id, "update");
    } else {
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO categorias (id, nome, tipo, icone, grupo_id, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, nome.value.trim(), tipo, icone.value.trim() || null, grupoSel.value || null, t, t, bd.idDispositivo()]
      );
      bd.enfileirar("categorias", id, "insert");
    }
    telaCategorias(tipo);
    render();
  };

  const corpo = [
    campo("Nome", nome),
    el("div", { class: "campo" }, [
      el("label", { text: "Ícone" }),
      grade,
      el("div", { class: "emoji-outro" }, [el("span", { class: "dica", text: "ou cole outro:" }), icone]),
    ]),
    campo("Grupo", grupoSel),
    erro,
    salvar,
  ];

  // Excluir com a regra do documento (RN-405): categoria em uso move as transações
  // para outra, em vez de deixá-las órfãs.
  if (cat && !cat.do_sistema) {
    const excluir = el("button", { class: "btn fantasma largo", type: "button", text: "Excluir", style: "margin-top:8px" });
    excluir.onclick = () => excluirCategoria(cat, tipo);
    corpo.push(excluir);
  } else if (cat?.do_sistema) {
    corpo.push(el("p", { class: "dica", text: "Categoria do sistema: recebe o que fica sem classificação e não pode ser excluída." }));
  }

  abrirFolha(cat ? "Editar categoria" : "Nova categoria", corpo);
  marcar();
}

function excluirCategoria(cat, tipo) {
  const usos = bd.valor("SELECT COUNT(*) FROM transacoes WHERE categoria_id = ? AND excluido_em IS NULL", [cat.id]);
  if (!usos) {
    bd.executar("UPDATE categorias SET excluido_em=?, atualizado_em=? WHERE id=?", [bd.agora(), bd.agora(), cat.id]);
    bd.enfileirar("categorias", cat.id, "delete");
    telaCategorias(tipo);
    render();
    return;
  }
  // Em uso: escolher o destino (RN-405), padrão "Outros".
  const outras = bd.todos(
    "SELECT id, nome FROM categorias WHERE excluido_em IS NULL AND tipo = ? AND id <> ? ORDER BY do_sistema, nome",
    [tipo, cat.id]
  );
  const destino = selectDe(outras, outras.find((o) => o.nome === "Outros")?.id);
  const ok = el("button", { class: "btn largo", type: "button", text: "Mover e excluir" });
  ok.onclick = () => {
    bd.transacao(() => {
      bd.executar("UPDATE transacoes SET categoria_id=?, atualizado_em=? WHERE categoria_id=? AND excluido_em IS NULL",
        [destino.value, bd.agora(), cat.id]);
      bd.executar("UPDATE categorias SET excluido_em=?, atualizado_em=? WHERE id=?", [bd.agora(), bd.agora(), cat.id]);
    });
    bd.enfileirar("categorias", cat.id, "delete");
    telaCategorias(tipo);
    render();
  };
  abrirFolha("Excluir categoria", [
    el("p", { style: "margin-top:0", text: `"${cat.nome}" está em ${usos} lançamentos.` }),
    el("p", { class: "dica", text: "Para onde vão esses lançamentos? Nenhum é apagado." }),
    campo("Mover para", destino),
    ok,
  ]);
}

function telaHistorico() {
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL ORDER BY nome");
  if (!contas.length) {
    return abrirFolha("Histórico da planilha",
      vazio(ICONES.carteira, "Cadastre a conta primeiro", "O histórico precisa de uma conta para pousar.",
            "Cadastrar conta", () => { $("#folha").close(); formConta(); }));
  }

  if (hist.jaMigrado()) {
    return abrirFolha("Histórico da planilha", [
      el("p", { style: "margin-top:0", text: "O histórico Jan–Jun já foi trazido." }),
      el("p", { class: "dica", text:
        "Trazer de novo não duplicaria nada, mas também não acrescentaria: o app reconhece " +
        "o que já entrou." }),
    ]);
  }

  const conta = selectDe(contas);
  const erro = el("p", { class: "erro" });
  const botao = el("button", { class: "btn largo", type: "button", text: "Trazer histórico" });

  botao.onclick = async () => {
    botao.disabled = true;
    botao.textContent = "Trazendo…";
    try {
      const r = await hist.migrar({ contaId: conta.value });
      const res = r.resumo;
      const corpo = [
        el("p", { style: "margin-top:0" }, [
          el("strong", { text: `${r.criados} lançamentos` }),
          el("span", { text: " trazidos de Janeiro a Junho." }),
        ]),
        el("div", { class: "bloco" }, [
          linhaResumo("Receitas", brl(res.receitas)),
          linhaResumo("Despesas efetivadas", brl(res.despesas_efetivadas)),
          linhaResumo(`Despesas pendentes (${res.qtd_pendentes} fixas)`, brl(res.despesas_pendentes)),
          linhaResumo("Categorias", String(res.categorias)),
        ]),
        el("p", { class: "dica", text:
          "As fixas sem pagamento entraram como pendentes: eram um plano, não um fato. " +
          "Elas contam no saldo previsto, não no atual." }),
      ];
      const nm = r.naoMigrado?.reservas ?? [];
      if (nm.length) {
        corpo.push(
          el("p", { class: "erro", text:
            "Ficou de fora: " + nm.map((x) => `${x.nome} (${x.tipo}) ${brl(Math.round(x.valor * 100))}`).join(", ") +
            ". Não é conta nem meta cadastrada — lance à mão se quiser." })
        );
      }
      const ok = el("button", { class: "btn largo", type: "button", text: "Ver" });
      ok.onclick = () => {
        $("#folha").close();
        estado.mes = 6;
        estado.tela = "transacoes";
        render();
      };
      corpo.push(ok);
      abrirFolha("Histórico trazido", corpo);
      render();
    } catch (e) {
      erro.textContent = e.message;
      botao.disabled = false;
      botao.textContent = "Trazer histórico";
    }
  };

  abrirFolha("Histórico da planilha", [
    el("p", { class: "dica", style: "margin-top:0", text:
      "Traz Janeiro a Junho de 2026 da Planilha de Organização Financeira: 1.317 lançamentos " +
      "e 30 categorias, já com os grupos." }),
    el("p", { class: "dica", text:
      "Esses meses guardam o mês da aba de origem, e não a regra 25→24 — foram organizados " +
      "à mão e recalculá-los mudaria números já conferidos." }),
    contas.length > 1 ? campo("Conta", conta) : null,
    erro,
    botao,
  ]);
}

const linhaResumo = (rot, val) =>
  el("div", { class: "item", style: "cursor:default" }, [
    el("div", { class: "item-corpo" }, el("div", { class: "item-sub", text: rot })),
    el("span", { class: "item-valor", text: val }),
  ]);

function vazio(icone, txt, sub, botao, acao) {
  const v = el("div", { class: "vazio" }, [
    el("div", { class: "vazio-icone" }, svg(icone)),
    el("p", { class: "vazio-txt", text: txt }),
    sub ? el("p", { class: "vazio-sub", text: sub }) : null,
  ]);
  if (botao) {
    const b = el("button", { class: "btn", type: "button", text: botao });
    b.onclick = () => acao();
    v.append(b);
  }
  return v;
}

/** Card que mostra saldo e, ao clicar, abre os lançamentos. */
function cardSimples(icone, nome, sub, valor, aoAbrir) {
  const item = el("button", { class: "item", type: "button" }, [
    el("span", { class: "item-icone" }, svg(icone)),
    el("div", { class: "item-corpo" }, [
      el("div", { class: "item-nome", text: nome }),
      sub ? el("div", { class: "item-sub", text: sub }) : null,
    ]),
    el("span", { class: "item-valor", text: valor }),
  ]);
  item.onclick = aoAbrir;
  return item;
}

/* ---------------- alertas (RN-131) ---------------- */

function calcularAlertas() {
  const lista = [];
  // Sem alerta de sincronização: os dados são locais e não sincronizamos o passado.
  const revisar = bd.valorUnico
    ? 0
    : (bd.todos("SELECT COUNT(*) AS n FROM transacoes WHERE excluido_em IS NULL AND revisar = 1")[0]?.n ?? 0);
  if (revisar) {
    lista.push({
      texto: "Lançamentos importados a classificar",
      n: revisar,
      acao: () => {
        estado.tela = "transacoes";
        render();
      },
    });
  }
  const fx = totalFixas(estado.mes, estado.ano);
  if (fx.qtdVencidas) {
    lista.push({
      texto: "Contas fixas vencidas",
      n: fx.qtdVencidas,
      acao: () => ((estado.tela = "planejamento"), render()),
    });
  }

  const negativas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0")
    .filter((c) => saldoConta(c.id) < 0);
  if (negativas.length) {
    lista.push({ texto: "Conta negativa", n: negativas.length, acao: () => (estado.tela = "principal", render()) });
  }

  // Validade do token do backup na nuvem: avisa para renovar antes de vencer.
  if (nuvem.estaConfigurado()) {
    const dias = nuvem.diasParaExpirar();
    if (dias != null && dias <= 10) {
      lista.push({
        texto: dias < 0 ? "Token do backup expirou — renove" : `Token do backup expira em ${dias} dia${dias === 1 ? "" : "s"}`,
        n: Math.max(0, dias),
        acao: () => telaBackup(),
      });
    }
  }
  return lista;
}

/* ---------------- folhas / formulários ---------------- */

function abrirFolha(titulo, corpo) {
  const f = $("#folha");
  // Trocar o conteúdo de uma <dialog> que já está aberta (showModal ativo) deixa o foco
  // preso no conteúdo antigo — foi por isso que não dava para digitar a senha: a folha
  // "Lendo…" continuava dona do foco. Fechar antes de reabrir devolve o foco ao novo.
  if (f.open) f.close();
  f.innerHTML = "";
  const topo = el("div", { class: "folha-topo" }, [
    el("h2", { class: "folha-titulo", text: titulo }),
    el("button", { class: "btn fantasma pequeno", type: "button", text: "Fechar" }),
  ]);
  topo.lastChild.onclick = () => f.close();
  f.append(topo, el("div", { class: "folha-corpo" }, corpo));
  f.showModal();
  return f;
}

function campo(rot, entrada, dica) {
  return el("div", { class: "campo" }, [
    el("label", { text: rot }),
    entrada,
    dica ? el("p", { class: "dica", text: dica }) : null,
  ]);
}

function selectDe(itens, valorAtual) {
  const s = el("select");
  for (const i of itens) {
    const o = el("option", { value: i.id ?? i.valor, text: i.nome ?? i.rotulo });
    if ((i.id ?? i.valor) === valorAtual) o.selected = true;
    s.append(o);
  }
  return s;
}

function formConta(conta = null) {
  const nome = el("input", { value: conta?.nome ?? "", placeholder: "C6 Bank" });
  const inst = el("input", { value: conta?.instituicao ?? "", placeholder: "Banco C6" });
  const saldo = el("input", { inputmode: "decimal", value: conta ? brl(conta.saldo_inicial).replace(/R\$\s*/, "") : "" });
  const erro = el("p", { class: "erro" });

  const salvar = el("button", { class: "btn largo", type: "button", text: conta ? "Salvar" : "Cadastrar conta" });
  salvar.onclick = () => {
    erro.textContent = "";
    if (!nome.value.trim()) return (erro.textContent = "Dê um nome à conta.");
    const inicialC = paraCentavos(saldo.value) ?? 0;
    const t = bd.agora();
    if (conta) {
      bd.executar(
        "UPDATE contas SET nome=?, instituicao=?, saldo_inicial=?, atualizado_em=? WHERE id=?",
        [nome.value.trim(), inst.value.trim() || null, inicialC, t, conta.id]
      );
      bd.enfileirar("contas", conta.id, "update");
    } else {
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO contas (id, nome, instituicao, tipo, saldo_inicial, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,'conta_corrente',?,?,?,?)`,
        [id, nome.value.trim(), inst.value.trim() || null, inicialC, t, t, bd.idDispositivo()]
      );
      bd.enfileirar("contas", id, "insert");
    }
    telaContas(); // volta para a lista de gerenciamento
    render();
  };

  const corpo = [
    campo("Nome", nome),
    campo("Instituição", inst),
    campo("Saldo inicial (R$)", saldo, "O saldo que a conta tinha quando você começou a controlar aqui."),
    erro,
    salvar,
  ];

  if (conta) {
    const usos = bd.valor(
      "SELECT COUNT(*) FROM transacoes WHERE excluido_em IS NULL AND (conta_id=? OR conta_origem_id=? OR conta_destino_id=?)",
      [conta.id, conta.id, conta.id]
    );
    const acao = el("button", { class: "btn fantasma largo", type: "button",
      text: usos ? "Arquivar conta" : "Excluir conta", style: "margin-top:8px" });
    acao.onclick = () => {
      const t = bd.agora();
      if (usos) {
        // Conta com transações não se apaga (RN-207): arquiva, para não sumir com histórico.
        bd.executar("UPDATE contas SET arquivada=1, atualizado_em=? WHERE id=?", [t, conta.id]);
      } else {
        bd.executar("UPDATE contas SET excluido_em=?, atualizado_em=? WHERE id=?", [t, t, conta.id]);
      }
      bd.enfileirar("contas", conta.id, usos ? "update" : "delete");
      telaContas();
      render();
    };
    corpo.push(acao);
    if (usos) corpo.push(el("p", { class: "dica", text: `Tem ${usos} lançamentos: arquivar preserva o histórico; excluir apagaria o passado.` }));
  }

  abrirFolha(conta ? "Editar conta" : "Cadastrar conta", corpo);
}

function formCartao(cartao = null) {
  const nome = el("input", { value: cartao?.nome ?? "", placeholder: "C6 Carbon" });
  const limite = el("input", { inputmode: "decimal", value: cartao?.limite ? brl(cartao.limite).replace(/R\$\s*/, "") : "" });
  const fech = el("input", { type: "number", min: "1", max: "31", value: cartao?.dia_fechamento ?? "" });
  const venc = el("input", { type: "number", min: "1", max: "31", value: cartao?.dia_vencimento ?? "" });
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL ORDER BY nome");
  const contaPg = selectDe(contas, cartao?.conta_pagamento_id);
  const erro = el("p", { class: "erro" });

  const salvar = el("button", { class: "btn largo", type: "button", text: cartao ? "Salvar" : "Adicionar cartão" });
  salvar.onclick = () => {
    erro.textContent = "";
    if (!nome.value.trim()) return (erro.textContent = "Dê um nome ao cartão.");
    const dF = Number(fech.value) || null;
    const dV = Number(venc.value) || null;
    // RN-804: dias de fechamento/vencimento entre 1 e 31.
    if ((dF && (dF < 1 || dF > 31)) || (dV && (dV < 1 || dV > 31))) {
      return (erro.textContent = "Fechamento e vencimento vão de 1 a 31.");
    }
    const t = bd.agora();
    if (cartao) {
      bd.executar(
        `UPDATE cartoes SET nome=?, limite=?, dia_fechamento=?, dia_vencimento=?,
                            conta_pagamento_id=?, atualizado_em=? WHERE id=?`,
        [nome.value.trim(), paraCentavos(limite.value), dF, dV, contaPg.value || null, t, cartao.id]
      );
      bd.enfileirar("cartoes", cartao.id, "update");
    } else {
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO cartoes (id, nome, limite, dia_fechamento, dia_vencimento, conta_pagamento_id,
                              criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, nome.value.trim(), paraCentavos(limite.value), dF, dV, contaPg.value || null, t, t, bd.idDispositivo()]
      );
      bd.enfileirar("cartoes", id, "insert");
    }
    telaCartoes();
    render();
  };

  const corpo = [
    campo("Nome", nome),
    campo("Limite total (R$)", limite),
    el("div", { class: "dois-campos" }, [campo("Dia de fechamento", fech), campo("Dia de vencimento", venc)]),
    contas.length ? campo("Conta de pagamento", contaPg) : null,
    erro,
    salvar,
  ];

  if (cartao) {
    const usos = bd.valor("SELECT COUNT(*) FROM transacoes WHERE excluido_em IS NULL AND cartao_id=?", [cartao.id]);
    const acao = el("button", { class: "btn fantasma largo", type: "button",
      text: usos ? "Arquivar cartão" : "Excluir cartão", style: "margin-top:8px" });
    acao.onclick = () => {
      const t = bd.agora();
      if (usos) bd.executar("UPDATE cartoes SET arquivado=1, atualizado_em=? WHERE id=?", [t, cartao.id]);
      else bd.executar("UPDATE cartoes SET excluido_em=?, atualizado_em=? WHERE id=?", [t, t, cartao.id]);
      bd.enfileirar("cartoes", cartao.id, usos ? "update" : "delete");
      telaCartoes();
      render();
    };
    corpo.push(acao);
    if (usos) corpo.push(el("p", { class: "dica", text: `Tem ${usos} lançamentos: arquivar preserva a fatura; excluir apagaria o passado.` }));
  }

  abrirFolha(cartao ? "Editar cartão" : "Adicionar cartão", corpo);
}

function formMeta(meta = null) {
  const nome = el("input", { value: meta?.nome ?? "", placeholder: "Reserva de Emergência" });
  const alvo = el("input", { inputmode: "decimal", value: meta?.alvo ? brl(meta.alvo).replace(/R\$\s*/, "") : "" });
  const erro = el("p", { class: "erro" });
  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar meta" });
  salvar.onclick = () => {
    erro.textContent = "";
    const a = paraCentavos(alvo.value);
    if (!nome.value.trim()) return (erro.textContent = "Dê um nome à meta.");
    if (!a || a <= 0) return (erro.textContent = "Informe um alvo maior que zero.");
    const t = bd.agora();
    const id = meta?.id ?? bd.uuid();
    if (meta) {
      bd.executar("UPDATE metas SET nome=?, alvo=?, atualizado_em=? WHERE id=?", [nome.value.trim(), a, t, id]);
    } else {
      bd.executar(
        "INSERT INTO metas (id, nome, alvo, criado_em, atualizado_em, dispositivo) VALUES (?,?,?,?,?,?)",
        [id, nome.value.trim(), a, t, t, bd.idDispositivo()]
      );
    }
    bd.enfileirar("metas", id, meta ? "update" : "insert");
    $("#folha").close();
    render();
  };
  const corpo = [
    campo("Nome", nome),
    campo("Quanto quer juntar (R$)", alvo,
      "Guardar para a meta não tira dinheiro da conta: reserva sobre o saldo que já está lá."),
    erro,
    salvar,
  ];
  if (meta) {
    const excluir = el("button", { class: "btn fantasma largo", type: "button", text: "Excluir meta", style: "margin-top:8px" });
    excluir.onclick = () => {
      // Soft delete: leva junto os aportes só logicamente.
      const t = bd.agora();
      bd.executar("UPDATE metas SET excluido_em=?, atualizado_em=? WHERE id=?", [t, t, meta.id]);
      bd.enfileirar("metas", meta.id, "delete");
      $("#folha").close();
      render();
    };
    corpo.push(excluir);
  }
  abrirFolha(meta ? "Editar meta" : "Nova meta", corpo);
}

/** Gerenciar metas — lista + adicionar. Vive em Mais. */
function telaMetas() {
  const metas = bd.todos(`
    SELECT m.*, COALESCE((SELECT SUM(a.valor) FROM aportes_meta a
                          WHERE a.meta_id = m.id AND a.excluido_em IS NULL), 0) AS guardado
    FROM metas m WHERE m.excluido_em IS NULL ORDER BY m.arquivada, m.alvo DESC`);
  const corpo = [];
  const nova = el("button", { class: "btn largo", type: "button", text: "Nova meta" });
  nova.onclick = () => formMeta();
  corpo.push(nova);
  if (metas.length) {
    const bloco = el("div", { class: "bloco", style: "margin-top:14px" });
    for (const m of metas) {
      const item = el("button", { class: "item", type: "button" });
      item.append(
        el("span", { class: "item-icone" }, svg(ICONES.alvo)),
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: m.nome }),
          el("div", { class: "item-sub", text: `${$$(m.guardado)} de ${$$(m.alvo)}` }),
        ])
      );
      item.onclick = () => formAporte(m);
      bloco.append(item);
    }
    corpo.push(bloco);
  } else {
    corpo.push(el("p", { class: "dica", style: "text-align:center;margin-top:16px", text:
      "Nenhuma meta ainda. Uma meta reserva dinheiro sobre o saldo, sem tirar da conta." }));
  }
  abrirFolha("Metas", corpo);
}

/** Cadastrar/atualizar um investimento — patrimônio aplicado, acompanhamento manual. */
function formInvestimento(inv = null) {
  const nome = el("input", { value: inv?.nome ?? "", placeholder: "CDB C6, Wise, Tesouro…" });
  const inst = el("input", { value: inv?.instituicao ?? "", placeholder: "instituição (opcional)" });
  const tipo = selectDe(
    ["CDB", "Fundo", "Ações", "Tesouro", "Previdência", "Cripto", "Outro"].map((v) => ({ valor: v, rotulo: v })),
    inv?.tipo ?? "CDB"
  );
  const aplicado = el("input", { inputmode: "decimal", value: inv?.valor_aplicado ? brl(inv.valor_aplicado).replace(/R\$\s*/, "") : "" });
  const atualIn = el("input", { inputmode: "decimal", value: inv?.valor_atual != null ? brl(inv.valor_atual).replace(/R\$\s*/, "") : "" });
  const erro = el("p", { class: "erro" });

  const salvar = el("button", { class: "btn largo", type: "button", text: inv ? "Salvar" : "Adicionar investimento" });
  salvar.onclick = () => {
    erro.textContent = "";
    if (!nome.value.trim()) return (erro.textContent = "Dê um nome ao investimento.");
    const vAp = paraCentavos(aplicado.value) ?? 0;
    const vAt = atualIn.value.trim() ? paraCentavos(atualIn.value) : null;
    const t = bd.agora();
    if (inv) {
      bd.executar(
        `UPDATE investimentos SET nome=?, instituicao=?, tipo=?, valor_aplicado=?, valor_atual=?, atualizado_em=? WHERE id=?`,
        [nome.value.trim(), inst.value.trim() || null, tipo.value, vAp, vAt, t, inv.id]
      );
      bd.enfileirar("investimentos", inv.id, "update");
    } else {
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO investimentos (id, nome, instituicao, tipo, valor_aplicado, valor_atual, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, nome.value.trim(), inst.value.trim() || null, tipo.value, vAp, vAt, t, t, bd.idDispositivo()]
      );
      bd.enfileirar("investimentos", id, "insert");
    }
    render();
    telaInvestimentos();
  };

  const corpo = [
    campo("Nome", nome),
    campo("Instituição", inst),
    campo("Tipo", tipo),
    campo("Valor aplicado inicial (R$)", aplicado, "O que já estava aplicado quando começou. Os aportes lançados somam por cima deste valor."),
    campo("Valor atual (R$)", atualIn, "Deixe vazio se ainda não rendeu. Atualize quando quiser acompanhar o rendimento."),
    erro,
    salvar,
  ];
  if (inv) {
    // Aportes/resgates lançados (tipo investimento) — o histórico e a soma do módulo.
    const movs = bd.todos(
      `SELECT * FROM transacoes WHERE excluido_em IS NULL AND tipo='investimento' AND investimento_id=?
       ORDER BY data DESC, criado_em DESC`, [inv.id]
    );
    const resumo = el("div", { class: "bloco", style: "margin-top:14px" }, [
      linhaResumo("Aplicado (com aportes)", $$(aplicadoInvestimento(inv.id))),
      inv.valor_atual != null ? linhaResumo("Rendimento", $$(inv.valor_atual - aplicadoInvestimento(inv.id))) : null,
    ].filter(Boolean));
    corpo.push(resumo);

    const aportar = el("button", { class: "btn largo", type: "button", text: "Registrar aporte / resgate" });
    aportar.onclick = () => formInvestir(inv.id);
    corpo.push(aportar);

    if (movs.length) {
      corpo.push(el("h3", { class: "grupo-titulo", text: "Movimentos" }));
      const lista = el("div", { class: "bloco" });
      for (const m of movs) {
        const aporte = !!m.conta_origem_id; // origem = saiu da conta p/ investir
        const linha = el("button", { class: "item", type: "button" });
        linha.append(
          el("div", { class: "item-corpo" }, [
            el("div", { class: "item-nome", text: aporte ? "Aporte" : "Resgate" }),
            el("div", { class: "item-sub", text: dataBR(m.data) + (m.descricao ? " · " + m.descricao : "") }),
          ]),
          el("span", { class: "item-valor " + (aporte ? "down" : "up"), text: (aporte ? "−" : "+") + $$(m.valor) })
        );
        linha.onclick = () => formEditarTransacao(m);
        lista.append(linha);
      }
      corpo.push(lista);
    }

    const excluir = el("button", { class: "btn fantasma largo", type: "button", text: "Excluir", style: "margin-top:8px" });
    excluir.onclick = () => {
      const t = bd.agora();
      bd.executar("UPDATE investimentos SET excluido_em=?, atualizado_em=? WHERE id=?", [t, t, inv.id]);
      bd.enfileirar("investimentos", inv.id, "delete");
      render();
      telaInvestimentos();
    };
    corpo.push(excluir);
  }
  abrirFolha(inv ? "Editar investimento" : "Novo investimento", corpo);
}

/** Gerenciar investimentos — lista + adicionar. Vive em Mais. */
function telaInvestimentos() {
  const invs = bd.todos("SELECT * FROM investimentos WHERE excluido_em IS NULL ORDER BY arquivado, nome");
  const corpo = [];
  const novo = el("button", { class: "btn largo", type: "button", text: "Adicionar investimento" });
  novo.onclick = () => formInvestimento();
  corpo.push(novo);
  if (invs.length) {
    const total = totalInvestido();
    const bloco = el("div", { class: "bloco", style: "margin-top:14px" });
    for (const inv of invs) {
      const item = el("button", { class: "item", type: "button" });
      item.append(
        el("span", { class: "item-icone" }, svg(ICONES.grafico)),
        el("div", { class: "item-corpo" }, [
          el("div", { class: "item-nome", text: inv.nome }),
          el("div", { class: "item-sub", text: [inv.tipo, inv.instituicao].filter(Boolean).join(" · ") || "toque para editar" }),
        ]),
        el("span", { class: "item-valor", text: $$(inv.valor_atual ?? aplicadoInvestimento(inv.id)) })
      );
      item.onclick = () => formInvestimento(inv);
      bloco.append(item);
    }
    bloco.append(el("div", { class: "total-linha" }, [el("span", { text: "Total" }), el("span", { text: $$(total) })]));
    corpo.push(bloco);
  } else {
    corpo.push(el("p", { class: "dica", style: "text-align:center;margin-top:16px", text:
      "Nenhum investimento ainda. Diferente da meta, o investimento é dinheiro que já saiu da conta e virou aplicação." }));
  }
  abrirFolha("Investimentos", corpo);
}

const NOVO_INVEST = "__novo__";

/** Novo lançamento de investimento: aporte (sai da conta) ou resgate (volta pra conta),
 *  vinculado a um investimento do módulo — o valor aplicado dele acompanha sozinho. */
function formInvestir(preId = null) {
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  if (!contas.length) {
    return abrirFolha("Novo investimento", vazio(ICONES.carteira, "Você ainda não tem contas",
      "O aporte sai de uma conta. Cadastre uma conta primeiro.", "Cadastrar conta",
      () => { $("#folha").close(); formConta(); }));
  }
  const investimentos = bd.todos("SELECT id, nome FROM investimentos WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");

  const valorIn = el("input", { inputmode: "decimal", placeholder: "0,00" });
  const data = el("input", { type: "date", value: iso(hoje) });
  const conta = selectDe(contas, contas[0]?.id);
  const desc = el("input", { placeholder: "opcional" });
  const sentido = selectDe([
    { valor: "aporte", rotulo: "Aporte — aplicar (sai da conta)" },
    { valor: "resgate", rotulo: "Resgate — resgatar (volta pra conta)" },
  ], "aporte");
  const invSel = selectDe([
    ...investimentos.map((i) => ({ id: i.id, nome: i.nome })),
    { id: NOVO_INVEST, nome: "➕ Novo investimento…" },
  ], preId ?? investimentos[0]?.id ?? NOVO_INVEST);
  const nomeNovo = el("input", { placeholder: "CDB C6, Tesouro, Fundo…" });
  const campoNomeNovo = campo("Nome do investimento", nomeNovo);
  const ajustarNovo = () => { campoNomeNovo.style.display = invSel.value === NOVO_INVEST ? "" : "none"; };
  invSel.onchange = ajustarNovo;
  const erro = el("p", { class: "erro" });

  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar" });
  salvar.onclick = () => {
    erro.textContent = "";
    const v = paraCentavos(valorIn.value);
    if (!v || v <= 0) return (erro.textContent = "Informe um valor maior que zero.");
    if (!data.value) return (erro.textContent = "Informe a data.");
    const t = bd.agora();
    const disp = bd.idDispositivo();

    let invId = invSel.value;
    if (invId === NOVO_INVEST) {
      if (!nomeNovo.value.trim()) return (erro.textContent = "Dê um nome ao investimento.");
      invId = bd.uuid();
      bd.executar(
        `INSERT INTO investimentos (id, nome, valor_aplicado, valor_atual, criado_em, atualizado_em, dispositivo)
         VALUES (?,?,0,NULL,?,?,?)`,
        [invId, nomeNovo.value.trim(), t, t, disp]
      );
      bd.enfileirar("investimentos", invId, "insert");
    }

    const aporte = sentido.value === "aporte";
    if (!aporte && v > aplicadoInvestimento(invId)) {
      return (erro.textContent = `Você só tem ${$$(aplicadoInvestimento(invId))} aplicado nesse investimento.`);
    }
    const { mes, ano } = competencia(data.value);
    const id = bd.uuid();
    // Aporte debita a conta (conta_origem); resgate credita (conta_destino). Igual a uma
    // transferência: move o saldo, mas não é receita nem despesa.
    bd.executar(
      `INSERT INTO transacoes (id, tipo, valor, descricao, data, mes, ano, conta_origem_id,
                               conta_destino_id, investimento_id, meio_pagamento, origem, situacao,
                               criado_em, atualizado_em, dispositivo)
       VALUES (?,'investimento',?,?,?,?,?,?,?,?,?,'manual','efetivada',?,?,?)`,
      [id, v, desc.value.trim() || null, data.value, mes, ano,
       aporte ? conta.value : null, aporte ? null : conta.value, invId, null, t, t, disp]
    );
    bd.enfileirar("transacoes", id, "insert");
    $("#folha").close();
    estado.mes = mes;
    estado.ano = ano;
    render();
  };

  ajustarNovo();
  abrirFolha("Novo investimento", [
    el("div", { class: "campo valor-grande" }, [el("label", { text: "Valor" }), valorIn]),
    campo("Tipo", sentido),
    campo("Investimento", invSel),
    campoNomeNovo,
    campo("Conta", conta, "De onde sai o aporte (ou para onde volta o resgate)."),
    campo("Data", data),
    campo("Descrição", desc),
    erro,
    salvar,
  ]);
}

const ROTULO_TIPO = {
  receita: "Nova receita",
  despesa: "Nova despesa",
  despesa_cartao: "Nova despesa de cartão",
  transferencia: "Nova transferência",
};

function formTransacao(tipo) {
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  const cartoes = bd.todos("SELECT id, nome FROM cartoes WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");

  if (tipo === "despesa_cartao" && !cartoes.length) {
    return abrirFolha("Nova despesa de cartão",
      vazio(ICONES.cartao, "Você ainda não tem cartão", "Cadastre um cartão para lançar a fatura.", "Adicionar cartão", () => { $("#folha").close(); formCartao(); }));
  }
  if (tipo !== "despesa_cartao" && !contas.length) {
    return abrirFolha(ROTULO_TIPO[tipo],
      vazio(ICONES.carteira, "Você ainda não tem contas", "A transação precisa saber de onde o dinheiro sai.", "Cadastrar conta", () => { $("#folha").close(); formConta(); }));
  }
  if (tipo === "transferencia" && contas.length + cartoes.length < 2) {
    return abrirFolha("Nova transferência",
      vazio(ICONES.carteira, "Falta um destino", "Transferência precisa de dois lugares: de onde sai e para onde vai."));
  }

  const valor = el("input", { inputmode: "decimal", placeholder: "0,00" });
  const desc = el("input", { placeholder: "opcional" });
  const data = el("input", { type: "date", value: iso(hoje) });

  const cats = bd.todos(
    "SELECT id, nome FROM categorias WHERE excluido_em IS NULL AND ativa = 1 AND tipo = ? ORDER BY do_sistema, nome",
    [tipo === "receita" ? "receita" : "despesa"]
  );
  const categoria = selectDe(cats);
  const conta = selectDe(contas);
  const cartao = selectDe(cartoes);
  // Transferência: destino pode ser conta ou cartão (pagar a fatura é o caso real dela).
  const destino = selectDe([
    ...contas.map((c) => ({ id: `c:${c.id}`, nome: c.nome })),
    ...cartoes.map((c) => ({ id: `k:${c.id}`, nome: `${c.nome} (fatura)` })),
  ]);
  const meio = selectDe([
    { valor: "pix", rotulo: "Pix" },
    { valor: "debito", rotulo: "Débito" },
    { valor: "dinheiro", rotulo: "Dinheiro" },
    { valor: "boleto", rotulo: "Boleto" },
  ]);
  // Provisório: lançar da notificação e deixar a importação confirmar (só faz sentido nos
  // tipos que vêm de fatura/extrato).
  const conciliavel = tipo === "receita" || tipo === "despesa" || tipo === "despesa_cartao";
  const provisorio = el("input", { type: "checkbox" });
  const campoProvisorio = el("label", { class: "campo", style: "flex-direction:row;align-items:center;gap:10px;cursor:pointer" }, [
    provisorio,
    el("span", { text: "Provisório — concilia na importação da fatura/extrato" }),
  ]);
  const erro = el("p", { class: "erro" });

  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar" });
  salvar.onclick = () => {
    erro.textContent = "";
    const v = paraCentavos(valor.value);
    if (!v || v <= 0) return (erro.textContent = "Informe um valor maior que zero."); // RN-804
    if (!data.value) return (erro.textContent = "Informe a data.");
    if (tipo === "transferencia" && `c:${conta.value}` === destino.value) {
      return (erro.textContent = "Origem e destino são a mesma conta.");
    }

    const { mes, ano } = competencia(data.value);
    const id = bd.uuid();
    const t = bd.agora();
    const base = {
      id, tipo, valor: v, descricao: desc.value.trim() || null, data: data.value, mes, ano,
      criado_em: t, atualizado_em: t, dispositivo: bd.idDispositivo(),
    };

    if (tipo === "transferencia") {
      const [especie, alvoId] = destino.value.split(":");
      bd.executar(
        `INSERT INTO transacoes (id, tipo, valor, descricao, data, mes, ano, conta_origem_id,
                                 conta_destino_id, cartao_id, meio_pagamento, origem, situacao,
                                 criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual','efetivada',?,?,?)`,
        [id, tipo, v, base.descricao, base.data, mes, ano, conta.value,
         especie === "c" ? alvoId : null, especie === "k" ? alvoId : null,
         meio.value, t, t, bd.idDispositivo()]
      );
    } else {
      bd.executar(
        `INSERT INTO transacoes (id, tipo, valor, descricao, data, mes, ano, conta_id, cartao_id,
                                 categoria_id, meio_pagamento, provisorio, origem, situacao,
                                 criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'manual','efetivada',?,?,?)`,
        [id, tipo, v, base.descricao, base.data, mes, ano,
         tipo === "despesa_cartao" ? null : conta.value,
         tipo === "despesa_cartao" ? cartao.value : null,
         categoria.value, tipo === "despesa_cartao" ? "credito" : meio.value,
         conciliavel && provisorio.checked ? 1 : 0, t, t, bd.idDispositivo()]
      );
    }
    bd.enfileirar("transacoes", id, "insert");
    $("#folha").close();
    // O lançamento pode cair noutro mês (a virada é dia 25): ir para lá é melhor do que
    // deixar a pessoa achando que não salvou.
    estado.mes = mes;
    estado.ano = ano;
    render();
  };

  abrirFolha(ROTULO_TIPO[tipo], [
    el("div", { class: "campo valor-grande" }, [el("label", { text: "Valor" }), valor]),
    campo("Data", data, "O mês vai de 25 a 24: uma data a partir do dia 25 entra no mês seguinte."),
    tipo !== "transferencia" ? campo("Categoria", categoria) : null,
    tipo === "despesa_cartao" ? campo("Cartão", cartao) : campo(tipo === "transferencia" ? "De" : "Conta", conta),
    tipo === "transferencia" ? campo("Para", destino) : null,
    tipo !== "despesa_cartao" ? campo("Meio de pagamento", meio) : null,
    campo("Descrição", desc),
    conciliavel ? campoProvisorio : null,
    erro,
    salvar,
  ]);
}

/* ---------------- lançamento rápido / colar lista (provisórios) ---------------- */

/** Categoria já usada para o mesmo COMERCIANTE — aprende por loja, não por texto exato. */
const catAprendidaApp = (desc, tipo) => {
  const chave = chaveMerchant(desc);
  if (!chave) return null;
  const base = tipo === "receita" ? "receita" : "despesa";
  const linhas = bd.todos(
    `SELECT descricao, categoria_id FROM transacoes
     WHERE excluido_em IS NULL AND categoria_id IS NOT NULL AND revisar = 0 AND descricao IS NOT NULL
       AND (CASE WHEN tipo='receita' THEN 'receita' ELSE 'despesa' END) = ?
     ORDER BY atualizado_em DESC`,
    [base]
  );
  for (const r of linhas) if (chaveMerchant(r.descricao) === chave) return r.categoria_id;
  return null;
};

/** Classifica automaticamente os pendentes que casam com um comerciante já aprendido. */
function autoClassificar() {
  const pend = bd.todos(
    "SELECT id, descricao, tipo FROM transacoes WHERE excluido_em IS NULL AND revisar = 1 AND descricao IS NOT NULL"
  );
  let n = 0;
  for (const p of pend) {
    const cat = catAprendidaApp(p.descricao, p.tipo);
    if (cat) {
      bd.executar("UPDATE transacoes SET categoria_id=?, revisar=0, atualizado_em=? WHERE id=?", [cat, bd.agora(), p.id]);
      bd.enfileirar("transacoes", p.id, "update");
      n++;
    }
  }
  return n;
}

const catSistema = (tipo) =>
  bd.valor("SELECT id FROM categorias WHERE do_sistema = 1 AND tipo = ? AND excluido_em IS NULL",
    [tipo === "receita" ? "receita" : "despesa"]);

/** Insere um lançamento provisório (origem manual, provisorio=1). Devolve a competência.
 *  mesForcado/anoForcado sobrepõem a competência (usado no cartão: vai na fatura escolhida,
 *  não na competência da data da compra). */
function inserirProvisorio({ tipo, valor, descricao, data, contaId, cartaoId, meio, mesForcado, anoForcado }) {
  const { mes, ano } = mesForcado && anoForcado ? { mes: mesForcado, ano: anoForcado } : competencia(data);
  const aprend = catAprendidaApp(descricao, tipo);
  const cat = aprend ?? catSistema(tipo);
  const id = bd.uuid();
  const t = bd.agora();
  bd.executar(
    `INSERT INTO transacoes (id, tipo, valor, descricao, data, mes, ano, conta_id, cartao_id,
                             categoria_id, meio_pagamento, provisorio, origem, situacao, revisar,
                             criado_em, atualizado_em, dispositivo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'manual','efetivada',?,?,?,?)`,
    [id, tipo, valor, descricao || null, data, mes, ano,
     tipo === "despesa_cartao" ? null : contaId,
     tipo === "despesa_cartao" ? cartaoId : null,
     cat, tipo === "despesa_cartao" ? "credito" : meio || "pix", aprend ? 0 : 1, t, t, bd.idDispositivo()]
  );
  bd.enfileirar("transacoes", id, "insert");
  return { mes, ano };
}

/** Lançamento rápido: para quando chega a notificação de um gasto. Já entra provisório. */
function formRapido() {
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  const cartoes = bd.todos("SELECT id, nome FROM cartoes WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");
  if (!contas.length && !cartoes.length) {
    return abrirFolha("Lançamento rápido", vazio(ICONES.carteira, "Sem conta nem cartão",
      "Cadastre uma conta ou um cartão para lançar."));
  }

  const valorIn = el("input", { inputmode: "decimal", placeholder: "0,00" });
  const desc = el("input", { placeholder: "opcional (ex.: Padaria)" });
  const data = el("input", { type: "date", value: iso(hoje) });
  const conta = selectDe(contas);
  const cartao = selectDe(cartoes);
  const campoConta = campo("Conta", conta);
  const campoCartao = campo("Cartão", cartao);
  const erro = el("p", { class: "erro" });

  // Fatura (mês de cobrança) — só para cartão. Padrão: mês seguinte.
  const h = competencia(hoje);
  let fm = h.mes + 1, fy = h.ano;
  if (fm > 12) { fm = 1; fy += 1; }
  const fatMes = selectDe(MESES.map((m, i) => ({ valor: String(i + 1), rotulo: m })), String(fm));
  const fatAno = selectDe([fy - 1, fy, fy + 1].map((y) => ({ valor: String(y), rotulo: String(y) })), String(fy));
  const campoFatura = el("div", { class: "campo" }, [
    el("label", { text: "Fatura (mês de cobrança)" }),
    el("div", { style: "display:flex;gap:8px" }, [fatMes, fatAno]),
  ]);

  const modos = [];
  if (contas.length) modos.push(["despesa", "Saída"], ["receita", "Entrada"]);
  if (cartoes.length) modos.push(["despesa_cartao", "Cartão"]);
  let modo = modos[0][0];
  const seg = el("div", { class: "abas-mini" });
  const btns = modos.map(([m, lbl]) => {
    const bx = el("button", { class: "aba-mini", type: "button", text: lbl });
    bx.onclick = () => { modo = m; pintar(); };
    seg.append(bx);
    return { m, bx };
  });
  const pintar = () => {
    const cartaoModo = modo === "despesa_cartao";
    btns.forEach((b) => b.bx.classList.toggle("sel", b.m === modo));
    campoConta.style.display = cartaoModo ? "none" : "";
    campoCartao.style.display = cartaoModo ? "" : "none";
    campoFatura.style.display = cartaoModo ? "" : "none";
  };

  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar (provisório)" });
  salvar.onclick = () => {
    erro.textContent = "";
    const v = paraCentavos(valorIn.value);
    if (!v || v <= 0) return (erro.textContent = "Informe um valor maior que zero.");
    if (!data.value) return (erro.textContent = "Informe a data.");
    const cartaoModo = modo === "despesa_cartao";
    const { mes, ano } = inserirProvisorio({
      tipo: modo, valor: v, descricao: desc.value.trim(), data: data.value,
      contaId: conta.value, cartaoId: cartao.value,
      mesForcado: cartaoModo ? Number(fatMes.value) : null,
      anoForcado: cartaoModo ? Number(fatAno.value) : null,
    });
    $("#folha").close();
    estado.mes = mes;
    estado.ano = ano;
    render();
  };

  pintar();
  abrirFolha("Lançamento rápido", [
    el("p", { class: "dica", style: "margin-top:0", text:
      "Para quando chega a notificação. Entra como provisório e concilia sozinho na importação da fatura/extrato." }),
    el("div", { class: "campo valor-grande" }, [el("label", { text: "Valor" }), valorIn]),
    campo("Tipo", seg),
    campoConta,
    campoCartao,
    campoFatura,
    campo("Data", data),
    campo("Descrição", desc),
    erro,
    salvar,
  ]);
}

/**
 * Extrai transações de um texto colado (a lista do print). Entende dois formatos:
 *  - uma transação por linha: "Uber   -R$ 23,50"
 *  - em BLOCO (o do cartão): data numa linha, loja noutra, "Cartão final 1014", "R$ 215,47".
 * O valor fecha cada transação; a data e a descrição vêm das linhas anteriores do bloco.
 */
function parseLista(texto) {
  const reValor = /(-|−|\+)?\s*R?\$?\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/;
  const reData = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;
  const reSoData = new RegExp(`^${reData.source}$`);
  const reCartao = /cart[aã]o\s*final\s*(\d{3,4})/i;
  const anoAtual = hoje.getFullYear();
  const normData = (m) => {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    let yy = m[3] ? String(m[3]) : String(anoAtual);
    if (yy.length === 2) yy = "20" + yy;
    return `${yy}-${mm}-${dd}`;
  };

  const itens = [];
  let dataPend = null;
  let descPend = [];
  let cartaoPend = null;
  const reset = () => { dataPend = null; descPend = []; cartaoPend = null; };

  for (const bruto of (texto || "").split(/\n/)) {
    const l = bruto.trim();
    if (!l) continue;

    const soData = l.match(reSoData);
    if (soData) { dataPend = normData(soData); continue; }

    const mc = l.match(reCartao);
    if (mc && l.replace(reCartao, "").trim() === "") { cartaoPend = mc[1]; continue; }

    const mv = l.match(reValor);
    if (mv) {
      const antes = l.slice(0, mv.index).replace(reCartao, "").trim();
      if (antes) descPend.push(antes);
      const v = paraCentavos(mv[2]);
      if (v != null && v !== 0) {
        const descricao = descPend.join(" ").replace(/\s+/g, " ").trim() || "—";
        const low = (descricao + " " + l).toLowerCase();
        const entrada = mv[1] === "+" || /recebid|cr[ée]dit|entrada|estorno|reembols|devolu|deposit/.test(low);
        itens.push({ data: dataPend, descricao, valor: Math.abs(v), tipo: entrada ? "receita" : "despesa", cartaoFinal: cartaoPend });
      }
      reset();
      continue;
    }

    // Linha de texto comum: parte da descrição.
    descPend.push(l);
  }
  return itens;
}

/** Revisar os itens extraídos e salvar como provisórios. O destino (conta/cartão) é
 *  escolhido aqui: se o texto tinha "Cartão final", já sugere o cartão e mostra a fatura. */
function revisarLista(itens) {
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  const cartoes = bd.todos("SELECT id, nome FROM cartoes WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");
  const opts = [
    ...contas.map((c) => ({ id: `c:${c.id}`, nome: c.nome })),
    ...cartoes.map((c) => ({ id: `k:${c.id}`, nome: `${c.nome} (cartão)` })),
  ];
  // Detecção: se o print tinha "Cartão final XXXX", o destino padrão é um cartão (o que casa
  // o final, se der; senão o primeiro) — é o que faltava para aparecer a fatura.
  const finalDetectado = itens.find((it) => it.cartaoFinal)?.cartaoFinal;
  let destinoPadrao = opts[0]?.id;
  if (finalDetectado && cartoes.length) {
    const casa = cartoes.find((c) => (c.nome || "").replace(/\D/g, "").includes(finalDetectado));
    destinoPadrao = `k:${(casa || cartoes[0]).id}`;
  }
  const destino = selectDe(opts, destinoPadrao);

  const dataFallback = el("input", { type: "date", value: iso(hoje) });
  const faltamData = itens.some((it) => !it.data);
  const campoData = campo("Data (itens sem data)", dataFallback);

  // Fatura (mês de cobrança) — só para cartão. Padrão: mês seguinte.
  const h = competencia(hoje);
  let fm = h.mes + 1, fy = h.ano;
  if (fm > 12) { fm = 1; fy += 1; }
  const fatMes = selectDe(MESES.map((m, i) => ({ valor: String(i + 1), rotulo: m })), String(fm));
  const fatAno = selectDe([fy - 1, fy, fy + 1].map((y) => ({ valor: String(y), rotulo: String(y) })), String(fy));
  const campoFatura = el("div", { class: "campo" }, [
    el("label", { text: "Fatura (mês de cobrança)" }),
    el("div", { style: "display:flex;gap:8px" }, [fatMes, fatAno]),
    el("p", { class: "dica", text: "Compras de cartão entram na fatura em que serão pagas." }),
  ]);

  const estados = itens.map((it) => ({ ...it, incluir: true, tipoSel: null }));
  const bloco = el("div", { class: "bloco" });
  for (const st of estados) {
    const cb = el("input", { type: "checkbox" });
    cb.checked = true;
    cb.onchange = () => { st.incluir = cb.checked; };
    st.tipoSel = selectDe([{ valor: "despesa", rotulo: "Saída" }, { valor: "receita", rotulo: "Entrada" }], st.tipo);
    st.tipoSel.style.width = "96px";
    st.tipoSel.onchange = () => { st.tipo = st.tipoSel.value; };
    bloco.append(el("label", { class: "item", style: "cursor:pointer" }, [
      cb,
      el("div", { class: "item-corpo" }, [
        el("div", { class: "item-nome", text: st.descricao }),
        el("div", { class: "item-sub", text: st.data ? dataBR(st.data) : "sem data" }),
      ]),
      st.tipoSel,
      el("span", { class: "item-valor", text: $$(st.valor) }),
    ]));
  }

  const ehCartao = () => destino.value.startsWith("k:");
  const atualizar = () => {
    campoFatura.style.display = ehCartao() ? "" : "none";
    estados.forEach((st) => { st.tipoSel.style.display = ehCartao() ? "none" : ""; });
  };
  destino.onchange = atualizar;

  const salvar = el("button", { class: "btn largo", type: "button", text: "Salvar provisórios" });
  salvar.onclick = () => {
    const [esp, id] = destino.value.split(":");
    const contaId = esp === "c" ? id : null;
    const cartaoId = esp === "k" ? id : null;
    let ultimo = null;
    for (const st of estados) {
      if (!st.incluir) continue;
      ultimo = inserirProvisorio({
        tipo: cartaoId ? "despesa_cartao" : st.tipo, valor: st.valor, descricao: st.descricao,
        data: st.data || dataFallback.value, contaId, cartaoId,
        mesForcado: cartaoId ? Number(fatMes.value) : null,
        anoForcado: cartaoId ? Number(fatAno.value) : null,
      });
    }
    $("#folha").close();
    if (ultimo) { estado.mes = ultimo.mes; estado.ano = ultimo.ano; }
    render();
  };

  const corpo = [
    el("p", { class: "dica", style: "margin-top:0", text: `${estados.length} encontrados. Confira o destino, desmarque os errados e Salvar.` }),
    campo("Onde caiu", destino),
    campoFatura,
  ];
  if (faltamData) corpo.push(campoData);
  corpo.push(bloco, salvar);
  abrirFolha("Revisar lançamentos", corpo);
  atualizar();
}

/** Colar a lista do print (texto extraído pelo celular) e virar vários provisórios. */
function formColarLista() {
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL AND arquivada = 0 ORDER BY nome");
  const cartoes = bd.todos("SELECT id, nome FROM cartoes WHERE excluido_em IS NULL AND arquivado = 0 ORDER BY nome");
  if (!contas.length && !cartoes.length) {
    return abrirFolha("Colar lista", vazio(ICONES.carteira, "Sem conta nem cartão", "Cadastre uma conta ou cartão primeiro."));
  }
  const area = el("textarea", { rows: "8", placeholder: "Cole aqui a lista (uma transação por linha)…",
    style: "width:100%;box-sizing:border-box;resize:vertical;min-height:120px" });
  const erro = el("p", { class: "erro" });
  const analisar = el("button", { class: "btn largo", type: "button", text: "Analisar" });
  analisar.onclick = () => {
    erro.textContent = "";
    const itens = parseLista(area.value);
    if (!itens.length) return (erro.textContent = "Não achei valores. Deixe uma transação por linha, com o valor (ex.: 71,74).");
    revisarLista(itens);
  };

  abrirFolha("Colar lista do dia", [
    el("p", { class: "dica", style: "margin-top:0", text:
      "No print do banco, use o \"copiar texto da imagem\" do celular (Google Lens / Live Text) e cole aqui. O destino (conta ou cartão) você escolhe no próximo passo." }),
    campo("Transações (uma por linha)", area),
    erro,
    analisar,
  ]);
}

function seletorMes(anoView) {
  // Chamado do clique (recebe o evento) ou da navegação de ano (recebe o número).
  if (typeof anoView !== "number") anoView = estado.ano;

  const nav = el("div", { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:14px" });
  const ant = el("button", { class: "btn fantasma pequeno", type: "button", text: "‹", "aria-label": "Ano anterior" });
  ant.onclick = () => seletorMes(anoView - 1);
  const prox = el("button", { class: "btn fantasma pequeno", type: "button", text: "›", "aria-label": "Próximo ano" });
  prox.onclick = () => seletorMes(anoView + 1);
  nav.append(ant, el("strong", { style: "font-size:18px", text: String(anoView) }), prox);

  const grade = el("div", { class: "meses" });
  MESES.forEach((m, i) => {
    const atual = i + 1 === estado.mes && anoView === estado.ano;
    const b = el("button", { class: "mes-op", type: "button", text: m, "aria-current": String(atual) });
    b.onclick = () => {
      estado.mes = i + 1;
      estado.ano = anoView;
      $("#folha").close();
      render();
    };
    grade.append(b);
  });
  abrirFolha("Escolher mês", [nav, grade]);
}

function abrirImportacao() {
  // Sem opção desabilitada: o PDF traz o cartão e a conta (nome, limite, saldo). Pedir
  // para cadastrar à mão antes seria exigir o que o arquivo já entrega — foi por isso
  // que não dava para chegar na senha da fatura.
  const escolha = el("div", { class: "escolha-arquivo" });
  for (const [especie, titulo, sub] of [
    ["fatura", "Fatura do cartão", "PDF do C6 — cadastra o cartão e traz limite e parcelas"],
    ["extrato", "Extrato da conta", "PDF ou OFX do C6 — o OFX é mais preciso (recomendado)"],
  ]) {
    const b = el("button", { class: "item", type: "button" });
    b.append(
      el("span", { class: "item-icone" }, svg(especie === "fatura" ? ICONES.cartao : ICONES.carteira)),
      el("div", { class: "item-corpo" }, [
        el("div", { class: "item-nome", text: titulo }),
        el("div", { class: "item-sub", text: sub }),
      ])
    );
    b.onclick = () => escolherArquivo(especie);
    escolha.append(b);
  }

  // Colar a lista do print (via "copiar texto da imagem" do celular) → provisórios.
  const bColar = el("button", { class: "item", type: "button" });
  bColar.append(
    el("span", { class: "item-icone" }, svg(ICONES.lista)),
    el("div", { class: "item-corpo" }, [
      el("div", { class: "item-nome", text: "Colar lista de transações" }),
      el("div", { class: "item-sub", text: "do print do dia — vira provisórios que conciliam depois" }),
    ])
  );
  bColar.onclick = () => formColarLista();
  escolha.append(bColar);

  abrirFolha("Importar", [
    el("p", { class: "dica", style: "margin:0 0 12px", text:
      "Importar o mesmo arquivo duas vezes é inofensivo: nada duplica." }),
    escolha,
  ]);
}

/** Garante conta/cartão de destino, criando a partir do cabeçalho do PDF se faltar. */
function garantirDestino(especie, cab) {
  const t = bd.agora();
  const disp = bd.idDispositivo();
  if (especie === "fatura") {
    let cartao = bd.um("SELECT id FROM cartoes WHERE excluido_em IS NULL ORDER BY criado_em LIMIT 1");
    if (!cartao) {
      const id = bd.uuid();
      bd.executar(
        `INSERT INTO cartoes (id, nome, instituicao, limite, dia_fechamento, dia_vencimento,
                              criado_em, atualizado_em, dispositivo)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, cab.nome_cartao || "Cartão", "C6 Bank", cab.limite ?? null,
         cab.dia_fechamento ?? null, cab.dia_vencimento ?? null, t, t, disp]
      );
      bd.enfileirar("cartoes", id, "insert");
      return { id, criado: true, nome: cab.nome_cartao || "Cartão" };
    }
    return { id: cartao.id, criado: false };
  }
  let conta = bd.um("SELECT id FROM contas WHERE excluido_em IS NULL ORDER BY criado_em LIMIT 1");
  if (!conta) {
    const id = bd.uuid();
    // O saldo do extrato é o de HOJE, já com os movimentos aplicados. O saldo inicial da
    // conta é ele menos tudo que vai entrar como transação, senão os movimentos contam
    // duas vezes. Como as transações ainda não foram gravadas, começa em zero e o saldo
    // é reconstruído pelos lançamentos.
    bd.executar(
      `INSERT INTO contas (id, nome, instituicao, tipo, saldo_inicial, criado_em, atualizado_em, dispositivo)
       VALUES (?,?,?,'conta_corrente',0,?,?,?)`,
      [id, cab.conta ? `C6 · conta ${cab.conta}` : "C6 Bank", "C6 Bank", t, t, disp]
    );
    bd.enfileirar("contas", id, "insert");
    return { id, criado: true, nome: "C6 Bank" };
  }
  return { id: conta.id, criado: false };
}

function escolherArquivo(especie) {
  // O extrato aceita OFX além de PDF; a fatura, só PDF (traz parcela e totais).
  const aceita = especie === "extrato" ? ".pdf,.ofx,application/pdf" : ".pdf,application/pdf";
  const entrada = el("input", { type: "file", accept: aceita });
  entrada.style.display = "none";
  document.body.append(entrada);
  entrada.onchange = () => {
    const arquivo = entrada.files?.[0];
    entrada.remove();
    if (arquivo) prepararImportacao(especie, arquivo);
  };
  entrada.click();
}

async function prepararImportacao(especie, arquivo) {
  // OFX é texto, não tem senha nem é PDF: vai direto para a leitura.
  if (imp.ehOfx(arquivo)) return lerEExibir(especie, arquivo, null);
  // Descobre se o PDF pede senha ANTES de abrir qualquer folha. Assim a folha de senha
  // não nasce por cima de uma folha "Lendo…" async — foi essa sobreposição que prendia
  // o foco e não deixava digitar.
  const protegido = await imp.pedeSenha(arquivo);
  if (protegido) {
    pedirSenha(especie, arquivo);
  } else {
    lerEExibir(especie, arquivo, null);
  }
}

function pedirSenha(especie, arquivo, mensagem = null) {
  const senha = el("input", { type: "password", placeholder: "Senha do PDF", autocomplete: "off" });
  const erro = el("p", { class: "erro", text: mensagem ?? "" });
  const ok = el("button", { class: "btn largo", type: "button", text: "Abrir" });
  ok.onclick = () => {
    if (!senha.value) return (erro.textContent = "Digite a senha.");
    lerEExibir(especie, arquivo, senha.value);
  };
  senha.onkeydown = (e) => {
    if (e.key === "Enter") ok.click();
  };
  abrirFolha("Arquivo protegido", [
    el("p", { class: "dica", style: "margin-top:0", text: `${arquivo.name} está protegido por senha.` }),
    campo("Senha", senha),
    erro,
    ok,
  ]);
  // autofocus do <input> dentro da <dialog> é o caminho que o navegador respeita; o
  // foco por JS competia com a gestão de foco do modal.
  senha.focus();
}

async function lerEExibir(especie, arquivo, senha) {
  const contas = bd.todos("SELECT id, nome FROM contas WHERE excluido_em IS NULL ORDER BY nome");
  const cartoes = bd.todos("SELECT id, nome FROM cartoes WHERE excluido_em IS NULL ORDER BY nome");

  abrirFolha(especie === "fatura" ? "Fatura do cartão" : "Extrato da conta",
    el("div", { style: "text-align:center;padding:30px" }, [
      el("div", { class: "girando", style: "margin:0 auto 14px" }),
      el("p", { class: "dica", text: `Lendo ${arquivo.name}…` }),
    ]));

  let analise;
  try {
    analise = await imp.analisar(especie, arquivo, { senha, contaId: contas[0]?.id, cartaoId: cartoes[0]?.id });
  } catch (e) {
    if (e.precisaSenha) return pedirSenha(especie, arquivo, "Senha incorreta. Tente de novo.");
    return abrirFolha("Não deu", [
      el("p", { class: "erro", style: "margin-top:0", text: e.message }),
      el("p", { class: "dica", text: "Confira se é o PDF da fatura ou do extrato do C6." }),
    ]);
  }
  mostrarConferencia(especie, arquivo, analise, contas, cartoes);
}

function linhaConf(rotulo, c) {
  return el("div", { class: "conf-linha " + (c.ok ? "ok" : "ruim") }, [
    el("span", { class: "conf-marca", text: c.ok ? "✓" : "!" }),
    el("span", { class: "conf-rot", text: rotulo }),
    el("span", { class: "conf-val", text: brl(c.lido) }),
  ]);
}

function mostrarConferencia(especie, arquivo, analise, contas, cartoes) {
  const corpo = [];
  const confere = especie === "fatura" ? analise.conferencia.confere : analise.confere;
  // OFX não declara totais mensais — não há aritmética a conferir; o FITID garante o resto.
  const semConferencia = confere === null;

  // A conferência vem primeiro e é o que decide se dá para gravar. É o único jeito de
  // confiar num parser de PDF: o arquivo declara os próprios totais, e ou bate, ou não.
  if (semConferencia) {
    corpo.push(el("div", { class: "conf" }, el("div", { class: "conf-topo" }, [
      el("strong", { text: "Extrato OFX" }),
      el("span", { class: "dica", text: arquivo.name }),
    ])));
  } else {
    const box = el("div", { class: "conf " + (confere ? "" : "ruim") });
    box.append(
      el("div", { class: "conf-topo" }, [
        el("strong", { text: confere ? "Confere com o PDF" : "Não fecha com o PDF" }),
        el("span", { class: "dica", text: arquivo.name }),
      ])
    );

    if (especie === "fatura") {
      const c = analise.conferencia;
      box.append(
        linhaConf("Total da fatura", c.total),
        linhaConf("Compras nacionais", c.nacionais),
        linhaConf("Compras internacionais", c.internacionais),
        linhaConf("IOF", c.iof),
        linhaConf("Estornos", c.estornos)
      );
    } else {
      for (const m of analise.conferencia) {
        box.append(
          linhaConf(`${m.mes} · entradas`, { lido: m.entradas_lidas, ok: m.ok }),
          linhaConf(`${m.mes} · saídas`, { lido: m.saidas_lidas, ok: m.ok })
        );
      }
    }
    corpo.push(box);

    if (!confere) {
      corpo.push(el("p", { class: "erro", text:
        "O que eu li não bate com os totais que o próprio arquivo declara — alguma linha " +
        "escapou. Não vou gravar: é melhor não ter o dado do que ter o dado errado." }));
      return abrirFolha("Importar", corpo);
    }
  }

  // Resumo do que vai entrar
  const resumo = el("div", { class: "bloco", style: "margin-top:14px" });
  const n = analise.itens.length;
  const linhas = [[`${n} lançamentos`, ""]];
  if (especie === "fatura") {
    const c = analise.cabecalho;
    linhas.push([`Lançados em ${MESES_LONGO[analise.mes - 1]}`, "a fatura inteira entra no mês em que é paga"]);
    if (c.limite) linhas.push([`Limite ${brl(c.limite)}`, `fecha dia ${c.dia_fechamento} · vence dia ${c.dia_vencimento}`]);
    const parc = analise.itens.filter((i) => i.parcela_num).length;
    if (parc) linhas.push([`${parc} compras parceladas`, ""]);
    if (analise.pagamentos.length)
      linhas.push([`${analise.pagamentos.length} pagamento de fatura`, "não é gasto — fica fora do total"]);
  } else {
    const t = analise.itens.filter((i) => i.tipo === "transferencia").length;
    const r = analise.itens.filter((i) => i.tipo === "receita").length;
    linhas.push([`${analise.itens.length - t - r} despesas · ${r} receitas · ${t} transferências`, ""]);
    const p = analise.itens.filter((i) => i.e_proprio_titular).length;
    if (p) linhas.push([`${p} Pix entre contas suas`, "marcados para você decidir se é entrada"]);
  }
  for (const [a, b] of linhas) {
    resumo.append(
      el("div", { class: "item", style: "cursor:default;display:block" }, [
        el("div", { class: "item-nome", text: a }),
        b ? el("div", { class: "item-sub", text: b }) : null,
      ])
    );
  }
  corpo.push(resumo);

  // Destino: se já existe conta/cartão, deixa escolher; se não, o PDF cria.
  const existentes = especie === "fatura" ? cartoes : contas;
  const alvo = selectDe(existentes);
  if (existentes.length > 1) {
    corpo.push(campo(especie === "fatura" ? "Cartão" : "Conta", alvo));
  } else if (!existentes.length) {
    const nome =
      especie === "fatura"
        ? analise.cabecalho.nome_cartao || "o cartão"
        : analise.cabecalho?.conta
        ? `a conta C6 (${analise.cabecalho.conta})`
        : "a conta";
    corpo.push(el("p", { class: "dica", text: `Vou cadastrar ${nome} a partir deste arquivo.` }));
  }

  const erro = el("p", { class: "erro" });
  const botao = el("button", { class: "btn largo", type: "button", text: `Importar ${n} lançamentos` });
  botao.onclick = () => {
    botao.disabled = true;
    botao.textContent = "Importando…";
    try {
      const destino = existentes.length
        ? { id: existentes.length > 1 ? alvo.value : existentes[0].id, criado: false }
        : garantirDestino(especie, analise.cabecalho || {});
      const r = imp.gravar(especie, analise, {
        arquivo: arquivo.name,
        cartaoId: especie === "fatura" ? destino.id : cartoes[0]?.id,
        contaId: especie === "extrato" ? destino.id : contas[0]?.id,
      });
      r.destinoCriado = destino.criado ? destino.nome : null;
      resultadoImportacao(especie, arquivo, r);
    } catch (e) {
      erro.textContent = e.message;
      botao.disabled = false;
      botao.textContent = `Importar ${n} lançamentos`;
    }
  };
  corpo.push(erro, botao);

  abrirFolha(especie === "fatura" ? "Fatura do cartão" : "Extrato da conta", corpo);
}

function resultadoImportacao(especie, arquivo, r) {
  const corpo = [];
  if (r.criados === 0 && r.duplicados > 0) {
    // "0 novos" lido sozinho parece falha. Dizer que o arquivo já entrou, e que nada
    // duplicou, é a informação que falta.
    corpo.push(
      el("p", { style: "margin-top:0", text: `${arquivo.name} já tinha sido importado.` }),
      el("p", { class: "dica", text:
        `Os ${r.duplicados} lançamentos deste arquivo já estão no app — nada foi duplicado.` })
    );
  } else {
    corpo.push(
      el("p", { style: "margin-top:0", text:
        `${r.criados} ${r.criados === 1 ? "lançamento novo" : "lançamentos novos"}` +
        (r.duplicados ? `, ${r.duplicados} já existiam.` : ".") }),
      r.revisar
        ? el("p", { class: "dica", text: `${r.revisar} entraram sem categoria e esperam sua classificação.` })
        : null,
      r.conciliados
        ? el("p", { class: "dica", text: `${r.conciliados} confirmaram lançamentos provisórios que você já tinha (sem duplicar).` })
        : null,
      r.provisionados
        ? el("p", { class: "dica", text: `${r.provisionados} parcelas futuras foram provisionadas nos próximos meses.` })
        : null
    );
  }
  const b = el("button", { class: "btn largo", type: "button", text: "Ver lançamentos" });
  b.onclick = () => {
    $("#folha").close();
    estado.tela = "transacoes";
    render();
  };
  corpo.push(b);
  abrirFolha("Importado", corpo);
  render();
}

function alternarTema() {
  const claro = document.documentElement.dataset.tema === "claro";
  document.documentElement.dataset.tema = claro ? "escuro" : "claro";
  bd.definirConfig("tema", claro ? "escuro" : "claro");
}

/* ---------------- início ---------------- */

function ligar() {
  document.querySelectorAll(".aba").forEach((a) => {
    a.onclick = () => {
      estado.tela = a.dataset.tela;
      render();
    };
  });
  $("#btn-mes").onclick = seletorMes;
  $("#btn-importar").onclick = abrirImportacao;
  $("#btn-nuvem").onclick = () => telaBackup();

  const leque = $("#leque");
  const fab = $("#btn-novo");
  const fechar = () => {
    leque.hidden = true;
    fab.setAttribute("aria-expanded", "false");
  };
  fab.onclick = () => {
    const aberto = !leque.hidden;
    leque.hidden = aberto;
    fab.setAttribute("aria-expanded", String(!aberto));
  };
  leque.querySelector("[data-fechar]").onclick = fechar;
  leque.querySelectorAll(".leque-op").forEach((op) => {
    op.onclick = () => {
      fechar();
      if (op.dataset.tipo === "rapido") formRapido();
      else if (op.dataset.tipo === "investimento") formInvestir();
      else formTransacao(op.dataset.tipo);
    };
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && fechar());
}

(async function iniciar() {
  try {
    await bd.abrir();
    const inicial = competencia(hoje);
    estado.mes = inicial.mes;
    estado.ano = inicial.ano;
    estado.ocultar = bd.config("ocultar_valores") === "1";
    document.documentElement.dataset.tema = bd.config("tema") === "claro" ? "claro" : "escuro";
    // O histórico Jan–Jun agora é informado à mão (valores fixos de referência) em vez de
    // lançamento a lançamento — ver formHistoricoMensal. Só migra a planilha se a pessoa
    // ainda não optou pelo histórico manual.
    if (!hist.jaMigrado() && bd.config("historico_manual") !== "1") {
      try {
        await hist.migrar({ contaId: bd.valor("SELECT id FROM contas WHERE excluido_em IS NULL ORDER BY criado_em LIMIT 1") });
      } catch (e) {
        console.warn("Histórico não carregado:", e.message);
      }
    }
    bd.aoGravar(agendarNuvem); // liga o auto-backup na nuvem (se configurado)
    ligar();
    render();
    $("#carregando").hidden = true;
    $("#app").hidden = false;
    registrarServiceWorker();
  } catch (e) {
    $("#carregando").innerHTML = `<p style="color:var(--despesa);padding:24px;text-align:center">
      Não consegui abrir o banco.<br><small>${e.message}</small></p>`;
    console.error(e);
  }
})();

/**
 * Registro do service worker com auto-atualização.
 *
 * O problema que isto resolve: quando o SW muda, o novo fica "esperando" enquanto o
 * antigo (cache-first) segue servindo código velho — e é por isso que uma alteração não
 * aparecia, com Chrome e Edge mostrando versões diferentes. Aqui: assim que um SW novo
 * assume o controle, a página recarrega uma vez, sozinha, pegando o código atual.
 */
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let recarregou = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recarregou) return;
    recarregou = true;
    location.reload();
  });
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    // Procura atualização a cada abertura; se houver, o novo SW se ativa e o
    // controllerchange acima recarrega.
    reg.update?.();
    reg.addEventListener?.("updatefound", () => {
      const novo = reg.installing;
      novo?.addEventListener("statechange", () => {
        if (novo.state === "installed" && navigator.serviceWorker.controller) {
          novo.postMessage?.({ tipo: "assumir" });
        }
      });
    });
  }).catch(() => {});
}
