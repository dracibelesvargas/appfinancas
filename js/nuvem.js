/**
 * Backup na nuvem via GitHub (Contents API).
 *
 * Modelo escolhido (ver DECISOES.md §8): backup, não sync de duas vias. O app ENVIA uma
 * cópia do banco automaticamente após mudanças; RESTAURAR é sempre um ato deliberado da
 * pessoa. Assim nada sobrescreve o aparelho sem pedido — sem conflito silencioso.
 *
 * Por que GitHub e não Drive: é só um token (PAT fine-grained), sem fluxo OAuth nem
 * carregar biblioteca externa — o que casa com o app ser offline-first e vendorizado. A
 * API do GitHub manda CORS aberto, então o fetch funciona do localhost.
 *
 * O token fica só no localStorage deste navegador — NUNCA no banco, para não acabar dentro
 * do próprio arquivo de backup enviado ao repositório.
 */

const API = "https://api.github.com";
const CH = { token: "nuvem_token", repo: "nuvem_repo", branch: "nuvem_branch", path: "nuvem_path", ultimo: "nuvem_ultimo", expira: "nuvem_expira" };

const ler = (k) => localStorage.getItem(k) || "";

export function info() {
  return {
    repo: ler(CH.repo),
    branch: ler(CH.branch) || "main",
    path: ler(CH.path) || "financas.sqlite",
    ultimo: ler(CH.ultimo) || null,
    expira: ler(CH.expira) || null,
    configurado: !!(ler(CH.token) && ler(CH.repo)),
  };
}

export const estaConfigurado = () => !!(ler(CH.token) && ler(CH.repo));

/** Dias até o token expirar (negativo = já expirou; null = sem validade informada). */
export function diasParaExpirar() {
  const e = ler(CH.expira);
  if (!e) return null;
  return Math.ceil((new Date(e).getTime() - Date.now()) / 86400000);
}

export function configurar({ token, repo, branch, path, validadeDias }) {
  if (token != null) localStorage.setItem(CH.token, token.trim());
  if (repo != null) localStorage.setItem(CH.repo, repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, ""));
  localStorage.setItem(CH.branch, (branch || "main").trim() || "main");
  localStorage.setItem(CH.path, (path || "financas.sqlite").trim() || "financas.sqlite");
  // Guarda a data de expiração para alertar a renovação (o GitHub não a expõe pela API).
  const dias = Number(validadeDias);
  if (Number.isFinite(dias) && dias > 0) {
    localStorage.setItem(CH.expira, new Date(Date.now() + dias * 86400000).toISOString());
  }
}

export function desconectar() {
  Object.values(CH).forEach((k) => localStorage.removeItem(k));
}

/* ---------------- base64 <-> bytes (em pedaços, para não estourar a pilha) ---------------- */

function bytesParaBase64(bytes) {
  let bin = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return btoa(bin);
}

function base64ParaBytes(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------- chamadas à API ---------------- */

async function req(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${ler(CH.token)}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  return r;
}

async function erroDe(r) {
  if (r.status === 401) return "Token inválido ou sem permissão (401).";
  if (r.status === 403) return "Acesso negado (403) — confira as permissões do token (Contents: Read and write).";
  if (r.status === 404) return "Repositório ou arquivo não encontrado (404) — confira usuario/repositorio e o branch.";
  let m = `Erro do GitHub (${r.status})`;
  try {
    const j = await r.json();
    if (j.message) m += `: ${j.message}`;
  } catch {}
  return m;
}

const urlConteudo = () => {
  const c = info();
  return `${API}/repos/${c.repo}/contents/${c.path.split("/").map(encodeURIComponent).join("/")}`;
};

async function shaAtual() {
  const c = info();
  const r = await req(`${urlConteudo()}?ref=${encodeURIComponent(c.branch)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await erroDe(r));
  return (await r.json()).sha;
}

/** Envia (cria/atualiza) o arquivo de backup no repositório. */
export async function enviar(bytes) {
  if (!estaConfigurado()) throw new Error("Configure o GitHub primeiro.");
  const c = info();
  const sha = await shaAtual();
  const corpo = {
    message: `backup ${new Date().toISOString()}`,
    content: bytesParaBase64(bytes),
    branch: c.branch,
  };
  if (sha) corpo.sha = sha; // atualizar exige o sha atual
  const r = await req(urlConteudo(), { method: "PUT", body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(await erroDe(r));
  localStorage.setItem(CH.ultimo, new Date().toISOString());
}

/** Baixa o arquivo de backup do repositório e devolve os bytes. */
export async function baixar() {
  if (!estaConfigurado()) throw new Error("Configure o GitHub primeiro.");
  const c = info();
  const r = await req(`${urlConteudo()}?ref=${encodeURIComponent(c.branch)}`);
  if (r.status === 404) throw new Error("Ainda não há backup na nuvem.");
  if (!r.ok) throw new Error(await erroDe(r));
  const j = await r.json();
  // Arquivos grandes vêm com content vazio; nesse caso baixa pelo download_url.
  if (j.content) return base64ParaBytes(j.content);
  const raw = await fetch(j.download_url);
  if (!raw.ok) throw new Error("Não consegui baixar o conteúdo do backup.");
  return new Uint8Array(await raw.arrayBuffer());
}
