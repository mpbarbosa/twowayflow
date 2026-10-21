import { flow } from "@twowayflow/dsl";

/**
 * The build-time half of `conversando_com_pessoa`: 2083 poem files in, a dense index and a
 * BM25 index out. Companion to `pessoa-rag.flow.ts`, which is the query-time half.
 *
 * The two are separate flows rather than one, because the project draws the line itself:
 * `corpus.jsonl` is *the boundary of the system* — everything downstream consumes it and
 * nothing consumes the `.txt` files. Keeping them apart is what makes ingestion testable on
 * its own and keeps the 35 s deduplication out of every startup.
 *
 * As a canvas exercise this file is the mirror of `pessoa-rag.flow.ts`: no cycle, but two
 * genuine fan-ins (`marcarDuplicados` and `corpusJsonl` each need inputs from more than one
 * upstream step) and a node whose three consumers run at different times.
 *
 * Upstream: https://github.com/mpbarbosa/conversando_com_pessoa — `src/corpus/build.py` for
 * stage one, `src/retrieval/index.py` for stage two.
 */
export default flow("pessoa-corpus-build")
  .node("ficheirosTxt", {
    kind: "source",
    at: [0, 220],
    label: "data/pessoa_poems",
    params: { ficheiros: 2083, palavras: 241250, proveniencia: "arquivopessoa.net" },
  })
  .node("parse", {
    kind: "transform",
    at: [300, 220],
    label: "cabeçalho autor/título/corpo",
    params: { modulo: "src/corpus/parse.py", sucesso: "2083/2083" },
  })
  // Jaccard over 4-grams scored 0.457 for two versions of the same poem and 0.480 for two
  // different poems, so it was replaced. The same lesson was learned again later in the
  // plagiarism guard, which is downstream in pessoa-rag.flow.ts.
  .node("detectarDuplicados", {
    kind: "transform",
    at: [640, 20],
    label: "detectar variantes",
    params: { gruposExactos: 3, gruposVariantes: 18, naoUsa: "Jaccard de 4-gramas" },
  })
  // Takes the poems *and* the report: a fan-in, not a link in a chain.
  .node("marcarDuplicados", {
    kind: "join",
    at: [900, 220],
    label: "marcar duplicados",
    params: { entram: 2083, indexaveis: 2062, incipitPartilhadoNaoColapsado: true },
  })
  // 480 is derived, not chosen: 512 - 2 (special) - 27 (longest header) - 2 (margin). The
  // arithmetic lives in the source so that changing the encoder changes the limit.
  .node("chunk", {
    kind: "transform",
    at: [1180, 220],
    label: "chunking",
    params: { limiteTokens: 480, derivadoDe: "512 - 2 - 27 - 2", chunks: 2290 },
  })
  // Fingerprints the chunk *text*, not file names and sizes. A change to parsing, dedup or
  // chunking moves the chunks without touching a single .txt, and the old scheme missed that.
  .node("assinatura", {
    kind: "transform",
    at: [1410, 20],
    label: "assinatura sha256",
    run: (chunks: readonly { poemId: string; chunkIx: number; indexedText: string }[]) =>
      chunks.map((c) => `${c.poemId}|${c.chunkIx}|${c.indexedText}`).join(""),
  })
  // The boundary. Written once by stage one, read three times by stage two — and the line
  // order *is* the id order of the dense index, which is why the manifest records it.
  .node("corpusJsonl", {
    kind: "join",
    at: [1460, 240],
    label: "data/corpus.jsonl",
    params: { idempotente: true, construcaoS: 40, ordemDasLinhasEIdDoIndice: true },
  })
  .node("encodePassages", {
    kind: "transform",
    at: [1750, 100],
    label: "encode_passages",
    params: { modelo: "multilingual-e5-base", prefixo: "passage: ", construcaoS: 383 },
  })
  .node("indiceDenso", {
    kind: "sink",
    at: [2040, 20],
    label: "data/index",
    params: { forma: [2290, 768], mb: 7.0, naoUsa: "FAISS", porque: "forca bruta, 1.8M ops" },
  })
  .node("indiceLexical", { kind: "sink", at: [1750, 560], label: "índice BM25" })
  // Refuses rather than rebuilding in silence, because an index loaded by mistake does not
  // error — it answers wrongly.
  .node("manifesto", {
    kind: "sink",
    at: [2040, 340],
    label: "manifesto",
    params: { compara: ["encoder", "assinatura", "n_chunks", "ordem"], seNaoBate: "None" },
  })
  .edge("ficheirosTxt", "parse", { label: "2083 .txt" })
  .edge("parse", "detectarDuplicados", { label: "poemas" })
  .edge("parse", "marcarDuplicados", { label: "poemas" })
  .edge("detectarDuplicados", "marcarDuplicados", { label: "relatório" })
  .edge("marcarDuplicados", "chunk", { label: "2062 indexáveis" })
  .edge("chunk", "assinatura", { label: "2290 chunks" })
  .edge("chunk", "corpusJsonl", { label: "chunks" })
  .edge("assinatura", "corpusJsonl", { label: "sha256" })
  .edge("detectarDuplicados", "corpusJsonl", { label: "_meta: grupos" })
  .edge("corpusJsonl", "encodePassages", { label: "indexed_text" })
  .edge("corpusJsonl", "indiceLexical", { label: "texto" })
  .edge("corpusJsonl", "manifesto", { label: "assinatura + ordem" })
  .edge("encodePassages", "indiceDenso", { label: "vectores" })
  .edge("encodePassages", "manifesto", { label: "encoder + dim" });
