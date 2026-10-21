import { flow } from "@twowayflow/dsl";

/**
 * The query-time pipeline of `conversando_com_pessoa` (PessoaBot): a local RAG chatbot that
 * answers in verse as Fernando Pessoa or one of his heteronyms.
 *
 * This is the one example here projected from a real codebase rather than invented, so the
 * node ids are the names the Python uses (`montar`, `gerar`, `verificar`, `repetir`) and the
 * `params` carry the project's own measured numbers. It is worth having because it exercises
 * three things the other two examples do not:
 *
 *  1. **A cycle.** `decidir -> repetirSem -> gerar` is the retry loop. Nothing in the DSL or
 *     the parser forbids one — edges are declared pairs, not nesting — and this is the file
 *     that proves it.
 *  2. **Fan-in that is not a `join` node.** `montar` takes the question, the persona and the
 *     retrieved poems from three different places.
 *  3. **Non-ASCII in opaque payload.** Portuguese labels and accented strings sit beside
 *     `at:`, and dragging a node must not touch a byte of them.
 *
 * Upstream: https://github.com/mpbarbosa/conversando_com_pessoa — `src/pipeline.py` runs this
 * as a hand-written loop, `src/grafo.py` declares the same policy as a LangGraph state graph,
 * and `tests/test_grafo.py` fails if the two ever disagree.
 */
export default flow("pessoa-rag")
  .node("pergunta", {
    kind: "source",
    at: [0, 400],
    label: "pergunta do utilizador",
    params: { de: ["src/cli.py", "src/web/fluxo.py"], idioma: ["pt", "en"] },
  })
  // The dense index refuses to load when its manifest does not match the corpus signature,
  // the encoder, the chunk count *and* the document order. Returning nothing is deliberate:
  // a stale index does not raise, it answers wrongly.
  .node("indiceDenso", {
    kind: "source",
    at: [660, 0],
    label: "índice denso (numpy)",
    params: { caminho: "data/index", chunks: 2290, dim: 768, mb: 7.0, buscaMs: 5.57 },
  })
  .node("indiceLexical", {
    kind: "source",
    at: [310, 620],
    label: "BM25",
    params: { lib: "rank_bm25", stopwords: "revistas à mão", ndcg5: 0.488 },
  })
  // `/auto` only. Measured 72% on 40 questions at +1.2 s; a corrected embedding centroid does
  // 68% for free, so the LLM router is not established as better — see docs/fase-4.
  .node("rotear", {
    kind: "transform",
    at: [310, 400],
    label: "roteador de voz",
    params: { modelo: "qwen2.5:7b", acerto: 0.72, custoS: 1.2, omissao: "desligado" },
  })
  // e5 requires its prefixes, and without them it degrades silently. The defence is not an
  // assertion but two separate methods, so there is no code path that forgets.
  .node("encodeQuery", {
    kind: "transform",
    at: [660, 160],
    label: "encode_queries",
    params: { modelo: "multilingual-e5-base", prefixo: "query: " },
  })
  .node("buscaDensa", {
    kind: "transform",
    at: [1010, 80],
    label: "top-20 denso",
    params: { ndcg5: 0.719, apt3: 0.95, profundidade: 20 },
  })
  .node("buscaBm25", { kind: "transform", at: [660, 620], label: "top-20 lexical" })
  // The two retrievers overlap by a median of 1/5, and not at all in 9 of 40 questions.
  // That disagreement is the whole reason fusion is worth doing.
  .node("fundirRrf", {
    kind: "join",
    at: [1360, 360],
    label: "fusão RRF",
    params: { k: 60, fonte: "Cormack et al., SIGIR 2009", dedupPor: "poem_id" },
    run: (rankings: readonly string[][], k = 60) => {
      const pontos = new Map<string, number>();
      for (const lista of rankings) {
        for (const [i, id] of lista.entries()) {
          pontos.set(id, (pontos.get(id) ?? 0) + 1 / (k + i + 1));
        }
      }
      return [...pontos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    },
  })
  // Opt-in: +0.090 nDCG@5 for +2.6 s. Never deeper than the top-20 pool the gold set covers,
  // or the measured delta stops meaning anything.
  .node("rerank", {
    kind: "filter",
    at: [1700, 360],
    label: "rerank (opcional)",
    params: { nRerank: 8, topK: 6, deltaNdcg5: 0.09, custoS: 2.6 },
  })
  .node("montar", {
    kind: "transform",
    at: [0, 940],
    label: "montar prompt",
    params: { personaEm: "system", orcamentoTokens: 500, cortaContextoNoLimite: true },
  })
  .node("gerar", {
    kind: "transform",
    at: [340, 940],
    label: "gerar (Ollama)",
    params: { modelo: "llama3.1:8b-instruct-q4_K_M", fluxo: true, prefillDaEspera: [0.58, 0.89] },
  })
  // Each guard here answers a failure mode seen in the blind evaluation, not an imagined one.
  .node("verificarPersona", {
    kind: "filter",
    at: [680, 940],
    label: "guarda de persona e língua",
    params: { observado: ["«Reis, na minha voz»", "«este poema não é do Reis»"] },
  })
  // The plan specified 8-gram overlap. The first full run copied three of eight verses at 2%
  // 8-gram overlap: the copying is paraphrase at verse level. Metric replaced, thresholds
  // calibrated on 30 real answers. Median verses copied went 82% -> 0%.
  .node("detectarPlagio", {
    kind: "filter",
    at: [1020, 940],
    label: "guarda de cópia",
    params: { metrica: "difflib por verso", limiarVerso: 0.72, naoUsa: "8-gramas" },
  })
  // The acceptance rule. In `pipeline.py` this is an `if` inside a `for`; in `grafo.py` it is
  // a conditional edge. Same condition either way, truncation included.
  .node("decidir", {
    kind: "fanout",
    at: [1360, 940],
    label: "serve?",
    run: (plagiou: boolean, truncada: boolean, tentativa: number, max = 2) => {
      const serve = !plagiou && !truncada;
      return serve || tentativa >= max ? "fim" : "repetir";
    },
  })
  // Asking the model to resist what is in front of it did not work: the retry on the same
  // context returned to the same poem. Dropping the copied poems removes the occasion, and
  // because the budget then admits the next candidates, the model gets new material rather
  // than less of it.
  .node("repetirSem", {
    kind: "transform",
    at: [680, 1160],
    label: "repetir sem os copiados",
    params: { maxTentativas: 2, taxaMedida: 0.21, corrigiu: "3 de 3", custoMedioGeracoes: 1.21 },
  })
  .node("turno", {
    kind: "sink",
    at: [1700, 940],
    label: "Turno",
    params: { mostra: ["texto", "fontes", "recuperacao_ms", "rerank_ms", "tentativas"] },
  })
  .edge("pergunta", "rotear", { label: "texto" })
  .edge("pergunta", "encodeQuery", { label: "consulta" })
  .edge("pergunta", "buscaBm25", { label: "termos" })
  .edge("pergunta", "montar")
  .edge("rotear", "buscaDensa", { label: "voz" })
  .edge("rotear", "buscaBm25", { label: "voz" })
  .edge("rotear", "montar", { label: "persona" })
  .edge("indiceDenso", "buscaDensa", { label: "vectores" })
  .edge("indiceLexical", "buscaBm25", { label: "postings" })
  .edge("encodeQuery", "buscaDensa", { label: "qv" })
  .edge("buscaDensa", "fundirRrf", { label: "denso" })
  .edge("buscaBm25", "fundirRrf", { label: "lexical" })
  .edge("fundirRrf", "rerank", { label: "candidatos" })
  .edge("rerank", "montar", { label: "top-6 poemas" })
  .edge("montar", "gerar", { label: "system + user" })
  .edge("gerar", "verificarPersona", { label: "versos" })
  .edge("verificarPersona", "detectarPlagio", { label: "texto aceite" })
  .edge("detectarPlagio", "decidir", { label: "veredicto" })
  .edge("decidir", "turno", { label: "fim" })
  .edge("decidir", "repetirSem", { label: "plagiou ou truncou" })
  // The back edge. `mostrados` accumulates across the whole turn, not just the current
  // attempt: dropping a poem from the prompt does not make it acceptable to hand back.
  .edge("repetirSem", "gerar", { label: "contexto novo + reforço" });
