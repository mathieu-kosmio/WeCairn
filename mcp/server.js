#!/usr/bin/env node
/**
 * WeCairn MCP (stdio) sur PocketBase
 *
 * Variables d'environnement :
 *   WECAIRN_URL       URL de l'instance PocketBase (ex. https://wecairn.kosm.io)
 *   WECAIRN_EMAIL     e-mail de l'utilisateur
 *   WECAIRN_PASSWORD  mot de passe de l'utilisateur (celui de l'inscription, ou réinitialisé depuis l'app)
 *
 * Le serveur se connecte avec le compte de l'utilisateur : les règles d'accès
 * PocketBase s'appliquent, il ne voit et n'écrit que dans son organisation.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import PocketBase from "pocketbase";
import { z } from "zod";

const env = (k) => {
  const v = process.env["WECAIRN_" + k] || process.env["WERETEX_" + k];
  if (!v) { console.error(`Variable manquante : WECAIRN_${k}`); process.exit(1); }
  return v;
};

const pb = new PocketBase(env("URL").replace(/\/+$/, ""));
pb.autoCancellation(false);

let me = null; // { id, organisation, name }
async function ensureAuth() {
  if (me && pb.authStore.isValid) return me;
  try {
    const { record } = await pb.collection("users").authWithPassword(env("EMAIL"), env("PASSWORD"));
    me = { id: record.id, organisation: record.organisation, name: record.name };
  } catch (e) {
    throw new Error(`Connexion WeCairn impossible : ${e.message}`);
  }
  return me;
}

// Score « tendance » façon reddit : votes pondérés par l'ancienneté (calculé côté client, SQLite oblige)
const hot = (r) => (r.vote_count + 1) / Math.pow((Date.now() - new Date(r.created)) / 3600000 + 2, 1.5);
const q = (s) => String(s).replace(/["\\]/g, ""); // neutralise les guillemets dans les filtres
const tagsOf = (r) => Array.isArray(r.tags) ? r.tags : [];

async function myVotes() {
  const me_ = await ensureAuth();
  const votes = await pb.collection("votes").getFullList({ filter: `user = "${me_.id}"`, fields: "id,retex" });
  return new Map(votes.map(v => [v.retex, v.id]));
}

const fmt = (r, voted) => [
  `### ${r.title}`,
  `id: ${r.id} · ${r.author_name} · ${new Date(r.created).toLocaleDateString("fr-FR")} · ▲ ${r.vote_count}${voted ? " (voté)" : ""} · ${r.comment_count} commentaire(s)`,
  tagsOf(r).length ? `tags: ${tagsOf(r).join(", ")}` : null,
  `Situation : ${r.situation}`,
  `Enseignement : ${r.learning}`,
  r.recommendation ? `Bonne pratique : ${r.recommendation}` : null,
  r.source_ref ? `Source : ${r.source_ref}` : null,
].filter(Boolean).join("\n");

const text = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (e) => ({ content: [{ type: "text", text: `Erreur : ${e?.response?.message ?? e.message ?? e}` }], isError: true });

const server = new McpServer({ name: "wecairn", version: "0.3.0" });

server.registerTool("list_retex", {
  title: "Lister les retex",
  description: "Liste les retex de mon organisation, triés par tendance, date ou votes. Filtre optionnel par tag.",
  inputSchema: {
    sort: z.enum(["hot", "new", "top"]).default("hot"),
    tag: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(15),
  },
}, async ({ sort, tag, limit }) => {
  try {
    await ensureAuth();
    const voted = await myVotes();
    let rows = await pb.collection("retex_feed").getList(1, 200, {
      sort: sort === "top" ? "-vote_count,-created" : "-created",
      filter: tag ? `tags ~ "${q(tag.toLowerCase())}"` : "",
    }).then(r => r.items);
    if (tag) rows = rows.filter(r => tagsOf(r).includes(tag.toLowerCase()));
    if (sort === "hot") rows.sort((a, b) => hot(b) - hot(a));
    rows = rows.slice(0, limit);
    return text(rows.length ? rows.map(r => fmt(r, voted.has(r.id))).join("\n\n") : "Aucun retex.");
  } catch (e) { return fail(e); }
});

server.registerTool("search_retex", {
  title: "Rechercher des retex",
  description: "Recherche dans les retex de mon organisation (titre, situation, enseignement, bonne pratique, tags). À utiliser avant de publier pour éviter les doublons, ou quand on cherche si l'équipe a déjà rencontré un problème.",
  inputSchema: { query: z.string().min(2), limit: z.number().int().min(1).max(50).default(10) },
}, async ({ query, limit }) => {
  try {
    await ensureAuth();
    const voted = await myVotes();
    // Chaque mot doit apparaître dans au moins un champ
    const words = query.split(/\s+/).map(q).filter(w => w.length >= 2);
    const filter = words.map(w => `(title ~ "${w}" || situation ~ "${w}" || learning ~ "${w}" || recommendation ~ "${w}" || tags ~ "${w}")`).join(" && ");
    const rows = await pb.collection("retex_feed").getList(1, limit, { filter, sort: "-vote_count,-created" }).then(r => r.items);
    return text(rows.length ? rows.map(r => fmt(r, voted.has(r.id))).join("\n\n") : `Aucun retex ne correspond à « ${query} ».`);
  } catch (e) { return fail(e); }
});

server.registerTool("get_retex", {
  title: "Lire un retex",
  description: "Affiche un retex complet avec ses commentaires.",
  inputSchema: { id: z.string().length(15) },
}, async ({ id }) => {
  try {
    await ensureAuth();
    const voted = await myVotes();
    const r = await pb.collection("retex_feed").getOne(id);
    const cs = await pb.collection("comments").getFullList({ filter: `retex = "${q(id)}"`, sort: "created", expand: "author" });
    const comments = cs.map(c => `- ${c.expand?.author?.name ?? "?"} (${new Date(c.created).toLocaleDateString("fr-FR")}) : ${c.body}`).join("\n");
    return text(fmt(r, voted.has(r.id)) + (comments ? `\n\nCommentaires :\n${comments}` : "\n\nAucun commentaire."));
  } catch (e) { return fail(e); }
});

const retexInput = {
  title: z.string().min(5).max(140).describe("L'enseignement en une phrase, formulé comme un conseil actionnable"),
  situation: z.string().min(10).describe("Le contexte : projet, réunion, problème rencontré"),
  learning: z.string().min(10).describe("Ce qu'on a appris, factuel, sans jugement de personne"),
  recommendation: z.string().optional().describe("La bonne pratique à reproduire (ou l'erreur à éviter)"),
  tags: z.array(z.string()).max(8).default([]).describe("Mots-clés courts en minuscules, ex. ['atelier', 'données']"),
  source: z.enum(["mcp", "transcript"]).default("mcp").describe("'transcript' si le retex est extrait d'un compte rendu ou d'une transcription de réunion"),
  source_ref: z.string().optional().describe("Référence de la source, ex. 'Réunion de lancement DataWood, 3 sept. 2026'"),
};
const toRecord = (i, p) => ({ ...i, recommendation: i.recommendation ?? "", source_ref: i.source_ref ?? "", organisation: p.organisation, author: p.id });

server.registerTool("create_retex", {
  title: "Publier un retex",
  description: "Publie un retex dans mon organisation au nom de l'utilisateur connecté (+10 points). Vérifier d'abord avec search_retex qu'un retex similaire n'existe pas déjà ; si c'est le cas, préférer un commentaire ou un vote.",
  inputSchema: retexInput,
}, async (input) => {
  try {
    const p = await ensureAuth();
    const r = await pb.collection("retex").create(toRecord(input, p));
    return text(`Retex publié (id ${r.id}) : « ${r.title} ». +10 points pour ${p.name}.`);
  } catch (e) { return fail(e); }
});

server.registerTool("create_retex_batch", {
  title: "Publier plusieurs retex",
  description: "Publie plusieurs retex d'un coup, typiquement après extraction depuis une transcription de réunion. Présenter la liste à l'utilisateur pour validation avant d'appeler cet outil.",
  inputSchema: { items: z.array(z.object(retexInput)).min(1).max(20) },
}, async ({ items }) => {
  try {
    const p = await ensureAuth();
    const done = [];
    for (const i of items) done.push(await pb.collection("retex").create(toRecord(i, p)));
    return text(`${done.length} retex publié(s) :\n` + done.map(d => `- ${d.title} (${d.id})`).join("\n"));
  } catch (e) { return fail(e); }
});

server.registerTool("update_retex", {
  title: "Modifier un de mes retex",
  description: "Modifie un retex dont l'utilisateur connecté est l'auteur (titre, situation, enseignement, bonne pratique, tags). Les champs omis sont conservés.",
  inputSchema: { id: z.string().describe("Identifiant du retex"), title: z.string().min(5).max(140).optional(), situation: z.string().min(10).optional(),
    learning: z.string().min(10).optional(), recommendation: z.string().optional(), tags: z.array(z.string()).max(8).optional() },
}, async ({ id, ...fields }) => {
  try {
    await ensureAuth();
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (data.tags) data.tags = data.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
    const r = await pb.collection("retex").update(id, data);
    return text(`Retex modifié (id ${r.id}) : « ${r.title} ».`);
  } catch (e) { return fail(e); }
});

server.registerTool("delete_retex", {
  title: "Supprimer un de mes retex",
  description: "Supprime définitivement un retex dont l'utilisateur connecté est l'auteur, avec ses votes et commentaires. Demander confirmation à l'utilisateur avant d'appeler cet outil.",
  inputSchema: { id: z.string().describe("Identifiant du retex") },
}, async ({ id }) => {
  try {
    await ensureAuth();
    await pb.collection("retex").delete(id);
    return text(`Retex ${id} supprimé.`);
  } catch (e) { return fail(e); }
});

server.registerTool("vote_retex", {
  title: "Voter pour un retex",
  description: "Marque un retex comme utile (ou retire le vote).",
  inputSchema: { id: z.string().length(15), remove: z.boolean().default(false) },
}, async ({ id, remove }) => {
  try {
    const p = await ensureAuth();
    const voted = await myVotes();
    if (remove) {
      if (voted.has(id)) await pb.collection("votes").delete(voted.get(id));
      return text("Vote retiré.");
    }
    if (!voted.has(id)) await pb.collection("votes").create({ retex: id, user: p.id });
    return text("Vote enregistré.");
  } catch (e) { return fail(e); }
});

server.registerTool("comment_retex", {
  title: "Commenter un retex",
  description: "Ajoute un commentaire (nuance, contre-exemple, complément) à un retex.",
  inputSchema: { id: z.string().length(15), body: z.string().min(1).max(4000) },
}, async ({ id, body }) => {
  try {
    const p = await ensureAuth();
    await pb.collection("comments").create({ retex: id, author: p.id, body });
    return text("Commentaire ajouté (+3 points).");
  } catch (e) { return fail(e); }
});

server.registerTool("leaderboard", {
  title: "Classement",
  description: "Classement des contributeurs de mon organisation (points, retex, votes).",
  inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
}, async ({ limit }) => {
  try {
    await ensureAuth();
    const rows = await pb.collection("leaderboard").getList(1, limit, { sort: "-points" }).then(r => r.items);
    return text(rows.map((r, i) => `${i + 1}. ${r.name} · ${r.points} pts (${r.retex_count} retex, ${r.votes_received} votes reçus, ${r.comments_count} commentaires)`).join("\n") || "Aucun contributeur.");
  } catch (e) { return fail(e); }
});

// Prompt réutilisable : extraire des retex d'une transcription ou d'un compte rendu
server.registerPrompt("extraire_retex", {
  title: "Extraire des retex d'une réunion",
  description: "Lit une transcription ou un compte rendu de réunion et en extrait les retex à publier, après validation.",
  argsSchema: { transcript: z.string().describe("Transcription ou compte rendu"), meeting_ref: z.string().optional().describe("Nom et date de la réunion") },
}, ({ transcript, meeting_ref }) => ({
  messages: [{
    role: "user",
    content: { type: "text", text:
`Voici une transcription de réunion${meeting_ref ? ` (${meeting_ref})` : ""}.

Extrais-en les retex : les enseignements réutilisables par l'équipe (ce qui a marché, ce qui a échoué et pourquoi, les bonnes pratiques à reproduire). Ignore les décisions opérationnelles, les actions à faire et les points d'information sans enseignement.

Pour chaque retex, propose : un titre (une phrase actionnable), la situation, l'enseignement, une bonne pratique si elle se dégage, 2 à 4 tags. Reste factuel, ne nomme pas les personnes de manière critique. Vise entre 1 et 6 retex, pas plus.

1. Utilise search_retex sur les thèmes principaux pour éviter les doublons.
2. Présente-moi la liste des retex proposés pour validation.
3. Après mon accord, publie-les avec create_retex_batch en indiquant source = "transcript" et source_ref = "${meeting_ref ?? "réunion"}".

Transcription :
"""
${transcript}
"""` }
  }]
}));

const transport = new StdioServerTransport();
await server.connect(transport);
