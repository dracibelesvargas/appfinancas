"""Extrai o histórico Jan-Jun do app antigo para um JSON que o PWA importa.

Roda uma vez. O app antigo (`controle-financeiro/dados.db`) foi semeado da Planilha de
Organização Financeira 2026 e é a única fonte desse histórico.

    python ferramentas/gerar-historico.py

Três decisões que valem registro:

1. **O mês vem da aba, não da data.** Jan–Jun foram organizados à mão na planilha, por
   critério próprio; recalcular pela regra 25→24 mudaria números já conferidos
   (DECISOES.md §2). Por isso `mes` é preservado e `data` fica só como informação.

2. **O ano é forçado para 2026.** O app antigo tirava o ano da data da compra, então uma
   compra de 14/11/2025 lançada na aba de Janeiro ficou com `ano=2025` — e 8 lançamentos
   ficaram em 2029, por um erro de digitação na planilha. Como o app antigo só filtrava
   por mês, isso nunca apareceu. No modelo novo `(mês, ano)` é chave, e sem corrigir eles
   se espalhariam por anos que não existem.

3. **Despesa fixa vira lançamento.** No modelo antigo ela era uma tabela à parte que
   entrava nas saídas por fora. Migrar só os lançamentos perderia R$ 38.709,64 de
   despesas reais. Fixa paga vira despesa efetivada; fixa sem pagamento vira despesa
   **pendente** (RN-502) — era um plano, não um fato.
"""

from __future__ import annotations

import json
import sqlite3
import unicodedata
from pathlib import Path

ANTIGO = Path.home() / "projects" / "pessoal" / "controle-financeiro" / "dados.db"
SAIDA = Path(__file__).parent.parent / "dados" / "historico-2026.json"
ANO = 2026

# Grupos de categoria (RN-410/RN-411). O critério: Essenciais é o que a casa precisa
# para funcionar; Lifestyle é escolha; Financeiro é dinheiro movendo dinheiro.
GRUPOS = {
    "Essenciais": [
        "Mercado", "Moradia", "Saúde", "Transporte", "Utilidades", "Custo", "Educação",
        "Pets", "Manutenção", "Reforma",
    ],
    "Lifestyle": [
        "Cuidado Pessoal", "Lazer", "Restaurantes", "Vestuário", "App/Streaming",
        "Presentes", "Noronha", "Ida a Cachoeira", "Ida a Caçador", "Suplementos",
    ],
    "Financeiro": [
        "Investimento", "Imposto", "Tarifa", "Seguro", "Serviços", "Serviços Profissionais",
        "Anúncios", "Dizimo", "Doações", "Igreja",
    ],
}
GRUPO_DE = {cat: g for g, cats in GRUPOS.items() for cat in cats}

# Emoji por categoria: RN-413 exige ícone. Escolha conservadora — ela troca no app.
ICONES = {
    "Mercado": "🛒", "Moradia": "🏠", "Saúde": "🩺", "Transporte": "🚗", "Utilidades": "💡",
    "Custo": "🧾", "Educação": "📚", "Pets": "🐾", "Manutenção": "🔧", "Reforma": "🧱",
    "Cuidado Pessoal": "💅", "Lazer": "🎭", "Restaurantes": "🍽️", "Vestuário": "👗",
    "App/Streaming": "📺", "Presentes": "🎁", "Noronha": "🏝️", "Ida a Cachoeira": "🏞️",
    "Ida a Caçador": "🛣️", "Suplementos": "💊", "Investimento": "📈", "Imposto": "🏛️",
    "Tarifa": "🏦", "Seguro": "🛡️", "Serviços": "🔨", "Serviços Profissionais": "💼",
    "Anúncios": "📣", "Dizimo": "⛪", "Doações": "🤝", "Igreja": "⛪",
    "Sem categoria": "❓",
}

MOEDA = 100  # centavos (RN-004)


def centavos(v) -> int:
    return int(round((v or 0) * MOEDA))


def sem_acento(t: str) -> str:
    n = unicodedata.normalize("NFKD", t or "")
    return "".join(c for c in n if not unicodedata.combining(c)).upper().strip()


def gerar() -> dict:
    if not ANTIGO.exists():
        raise SystemExit(f"Banco antigo não encontrado: {ANTIGO}")

    con = sqlite3.connect(ANTIGO)
    con.row_factory = sqlite3.Row

    # --- categorias usadas em Jan-Jun (lançamentos + fixas)
    nomes = {
        r[0]
        for r in con.execute(
            "SELECT DISTINCT categoria_canonica FROM lancamentos WHERE mes BETWEEN 1 AND 6 AND tipo='gasto'"
        )
    } | {
        r[0]
        for r in con.execute(
            "SELECT DISTINCT categoria FROM fixas WHERE mes BETWEEN 1 AND 6 AND categoria IS NOT NULL"
        )
    }
    nomes.discard("Sem categoria")  # já existe no app, como categoria do sistema

    categorias = [
        {
            "nome": n,
            "tipo": "despesa",
            "grupo": GRUPO_DE.get(n),
            "icone": ICONES.get(n, "•"),
        }
        for n in sorted(nomes)
    ]

    # --- lançamentos
    lancamentos = []
    for r in con.execute(
        """SELECT tipo, categoria_canonica, descricao, forma_pagamento, cartao, parcela,
                  valor, data, mes
           FROM lancamentos WHERE mes BETWEEN 1 AND 6 ORDER BY mes, data"""
    ):
        entrada = r["tipo"] == "entrada"
        lancamentos.append(
            {
                "tipo": "receita" if entrada else "despesa",
                "valor": centavos(r["valor"]),
                # Entrada da planilha não tem data (o mês vinha da aba). Sem data o
                # schema novo não aceita; o dia 1 é o único que não muda o mês em
                # nenhuma regra (a virada é no 25).
                "data": r["data"] or f"{ANO}-{r['mes']:02d}-01",
                "mes": r["mes"],
                "ano": ANO,
                "categoria": None if entrada else r["categoria_canonica"],
                "descricao": r["descricao"] or (None if entrada else None),
                "meio": meio_de(r["forma_pagamento"]),
                "cartao_final": r["cartao"],
                "parcela": r["parcela"],
            }
        )

    # --- fixas viram lançamentos: pagas = efetivadas, sem pagamento = pendentes
    for r in con.execute(
        """SELECT mes, categoria, descricao, planejado, valor_pago, data_pago, dia_vencimento
           FROM fixas WHERE mes BETWEEN 1 AND 6 ORDER BY mes"""
    ):
        pago = r["valor_pago"] is not None
        valor = r["valor_pago"] if pago else r["planejado"]
        if not valor:
            continue
        lancamentos.append(
            {
                "tipo": "despesa",
                "valor": centavos(valor),
                "data": r["data_pago"] or f"{ANO}-{r['mes']:02d}-{min(r['dia_vencimento'] or 1, 28):02d}",
                "mes": r["mes"],
                "ano": ANO,
                "categoria": r["categoria"],
                "descricao": r["descricao"],
                "meio": "boleto",
                "situacao": "efetivada" if pago else "pendente",
                "fixa": True,
            }
        )

    # --- entradas: os nomes viram a lista de sugestões
    nomes_entrada = sorted(
        {
            r[0]
            for r in con.execute(
                "SELECT DISTINCT descricao FROM lancamentos WHERE mes BETWEEN 1 AND 6 AND tipo='entrada' AND descricao IS NOT NULL"
            )
        }
    )

    # --- reservas: fica de fora, e o motivo tem de aparecer no relatório
    reservas = [
        dict(r)
        for r in con.execute("SELECT mes, nome, tipo, valor FROM reservas WHERE mes BETWEEN 1 AND 6")
    ]

    con.close()

    total_r = sum(l["valor"] for l in lancamentos if l["tipo"] == "receita")
    total_d = sum(l["valor"] for l in lancamentos if l["tipo"] == "despesa" and l.get("situacao", "efetivada") == "efetivada")
    pendentes = [l for l in lancamentos if l.get("situacao") == "pendente"]

    return {
        "versao": 1,
        "origem": "Planilha de Organização Financeira 2026 (via app antigo)",
        "periodo": "Jan a Jun de 2026",
        "categorias": categorias,
        "nomes_entrada": nomes_entrada,
        "lancamentos": lancamentos,
        "nao_migrado": {"reservas": reservas},
        "resumo": {
            "lancamentos": len(lancamentos),
            "categorias": len(categorias),
            "receitas": total_r,
            "despesas_efetivadas": total_d,
            "despesas_pendentes": sum(l["valor"] for l in pendentes),
            "qtd_pendentes": len(pendentes),
        },
    }


def meio_de(forma: str | None) -> str:
    """Forma de pagamento da planilha -> meio de pagamento do modelo novo (RN-510)."""
    f = sem_acento(forma or "")
    if "CREDITO" in f:
        return "credito"
    if "DEBITO" in f:
        return "debito"
    if "PIX" in f or "DINHEIRO" in f:
        return "pix"
    return "debito"


if __name__ == "__main__":
    dados = gerar()
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    r = dados["resumo"]
    print(f"gerado: {SAIDA}  ({SAIDA.stat().st_size/1024:.0f} KB)")
    print(f"  {r['lancamentos']} lançamentos · {r['categorias']} categorias")
    print(f"  receitas             R$ {r['receitas']/100:>12,.2f}")
    print(f"  despesas efetivadas  R$ {r['despesas_efetivadas']/100:>12,.2f}")
    print(f"  despesas pendentes   R$ {r['despesas_pendentes']/100:>12,.2f}  ({r['qtd_pendentes']} fixas sem pagamento)")
    if dados["nao_migrado"]["reservas"]:
        print("  NÃO migrado:")
        for x in dados["nao_migrado"]["reservas"]:
            print(f"    reserva mês {x['mes']}: {x['nome']} ({x['tipo']}) R$ {x['valor']:,.2f}")
