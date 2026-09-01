import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  ApplyMatchActionBody,
  CreateMatchSessionBody,
  GetDifficultyCatalogParams,
  JoinMatchSessionBody,
} from "@workspace/api-zod";
import { db, matchSessionsTable } from "@workspace/db";

type ChartTag =
  | "物量"
  | "ハネリズム"
  | "階段"
  | "乱打"
  | "トリル"
  | "同時押し"
  | "低速"
  | "高速"
  | "混合"
  | "未分類";

type CatalogSong = {
  id: string;
  title: string;
  artist: string;
  chart: string;
  officialDifficulty: number | null;
  unofficialDifficulty: number;
  pack: string;
  chartTags: ChartTag[];
  sourceUrl: string;
};

type RoundState = {
  label: string;
  lower: number;
  upper: number;
  tag: ChartTag | null;
  p1Card: boolean;
  p2Card: boolean;
  resolved: boolean;
  pickedSongId: string | null;
  pickedSongTitle: string | null;
};

type InternalSession = {
  key: string;
  hostToken: string;
  guestToken: string | null;
  p1: string;
  p2: string | null;
  status: "waiting" | "setup" | "active" | "finished";
  button: 4 | 5 | 6 | 8;
  centerDifficulty: number;
  lowerOffset: number;
  upperOffset: number;
  p1Owned: string[];
  p2Owned: string[];
  selectedPacks: string[];
  currentRound: number;
  rounds: RoundState[];
  updatedAt: string;
};

const router: IRouter = Router();
const sessionKeyAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const chartTags: ChartTag[] = [
  "物量",
  "ハネリズム",
  "階段",
  "乱打",
  "トリル",
  "同時押し",
  "低速",
  "高速",
  "混合",
];
const catalogCache = new Map<number, { songs: CatalogSong[]; source: "v-archive" | "fallback"; fetchedAt: string }>();

const fallbackSongs: CatalogSong[] = [
  ["733", "#1f1e33", "ARC", 15.2, "V-ARCHIVE", ["階段", "乱打"]],
  ["654", "1! 2! 3! 4! Streaming rn CHU!", "VL2", 15.2, "V-ARCHIVE", ["同時押し", "ハネリズム"]],
  ["553", "DIE IN", "VE4", 16.1, "V-ARCHIVE", ["物量", "高速"]],
  ["756", "Heliocentrism", "VL4", 15.3, "V-ARCHIVE", ["階段", "高速"]],
  ["544", "LIMBO", "EZ2", 15.2, "V-ARCHIVE", ["低速", "混合"]],
  ["81", "Nightmare", "P2", 15.3, "V-ARCHIVE", ["物量", "乱打"]],
  ["476", "PUPA", "MD", 15.2, "V-ARCHIVE", ["乱打", "高速"]],
  ["722", "PUPA (xi Remix)", "RV", 15.2, "V-ARCHIVE", ["乱打", "トリル"]],
  ["713", "Rise Up", "VL3", 15.2, "V-ARCHIVE", ["物量", "同時押し"]],
  ["767", "The Castle of Báthory", "VL4", 15.2, "V-ARCHIVE", ["低速", "階段"]],
  ["524", "Zero-Break", "VE3", 15.3, "V-ARCHIVE", ["物量", "ハネリズム"]],
  ["545", "Zeroize", "EZ2", 15.2, "V-ARCHIVE", ["トリル", "高速"]],
  ["783", "And Revive The Melody", "OGK", 15.2, "V-ARCHIVE", ["ハネリズム", "同時押し"]],
  ["789", "LAMIA", "OGK", 15.3, "V-ARCHIVE", ["物量", "高速"]],
  ["794", "MEGATØNiX PHANTØM", "CP", 15.2, "V-ARCHIVE", ["乱打", "混合"]],
  ["815", "Megingjord", "VL5", 15.2, "V-ARCHIVE", ["物量", "階段"]],
  ["807", "RE;DIEIN", "VL5", 15.2, "V-ARCHIVE", ["乱打", "高速"]],
  ["810", "Sleipnir", "VL5", 15.2, "V-ARCHIVE", ["トリル", "高速"]],
].map(([id, title, chart, level, pack, tags]) => ({
  id: String(id),
  title: String(title),
  artist: "V-ARCHIVE",
  chart: String(chart),
  officialDifficulty: null,
  unofficialDifficulty: Number(level),
  pack: String(pack),
  chartTags: tags as ChartTag[],
  sourceUrl: `https://v-archive.net/db/title/${id}`,
}));

function makeKey() {
  let key = "";
  for (let index = 0; index < 6; index += 1) {
    key += sessionKeyAlphabet[randomBytes(1)[0] % sessionKeyAlphabet.length];
  }
  return key;
}

function makeToken() {
  return randomBytes(18).toString("base64url");
}

function roundRange(center: number, lowerOffset: number, upperOffset: number): RoundState[] {
  const lowBoundary = Math.max(1, Number((center - 0.1).toFixed(1)));
  const highBoundary = Math.min(20, Number((center + 0.1).toFixed(1)));
  return [
    {
      label: "LOW",
      lower: Number(Math.max(1, center - lowerOffset).toFixed(1)),
      upper: lowBoundary,
      tag: null,
      p1Card: false,
      p2Card: false,
      resolved: false,
      pickedSongId: null,
      pickedSongTitle: null,
    },
    {
      label: "MID",
      lower: lowBoundary,
      upper: highBoundary,
      tag: null,
      p1Card: false,
      p2Card: false,
      resolved: false,
      pickedSongId: null,
      pickedSongTitle: null,
    },
    {
      label: "HIGH",
      lower: highBoundary,
      upper: Number(Math.min(20, center + upperOffset).toFixed(1)),
      tag: null,
      p1Card: false,
      p2Card: false,
      resolved: false,
      pickedSongId: null,
      pickedSongTitle: null,
    },
  ];
}

function roleFor(session: InternalSession, token: string | undefined) {
  if (token && token === session.hostToken) return "host" as const;
  if (token && token === session.guestToken) return "guest" as const;
  return "full" as const;
}

function responseFor(session: InternalSession, token: string | undefined) {
  return {
    key: session.key,
    role: roleFor(session, token),
    status: session.status,
    p1: session.p1,
    p2: session.p2,
    button: session.button,
    centerDifficulty: session.centerDifficulty,
    lowerOffset: session.lowerOffset,
    upperOffset: session.upperOffset,
    p1Owned: session.p1Owned,
    p2Owned: session.p2Owned,
    selectedPacks: session.selectedPacks,
    currentRound: session.currentRound,
    rounds: session.rounds,
    updatedAt: session.updatedAt,
    clientToken: token === session.guestToken
      ? session.guestToken
      : token === session.hostToken
        ? session.hostToken
        : "",
  };
}

async function readSession(key: string) {
  const rows = await db
    .select()
    .from(matchSessionsTable)
    .where(eq(matchSessionsTable.sessionKey, key))
    .limit(1);
  return rows[0] ? (rows[0].state as InternalSession) : null;
}

async function saveSession(session: InternalSession) {
  session.updatedAt = new Date().toISOString();
  await db
    .insert(matchSessionsTable)
    .values({
      sessionKey: session.key,
      state: session,
      updatedAt: new Date(session.updatedAt),
    })
    .onConflictDoUpdate({
      target: matchSessionsTable.sessionKey,
      set: { state: session, updatedAt: new Date(session.updatedAt) },
    });
}

function normalizeTitle(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function guessTags(title: string): ChartTag[] {
  const normalized = title.toLowerCase();
  if (normalized.includes("pupa") || normalized.includes("zero")) return ["乱打", "高速"];
  if (normalized.includes("nightmare") || normalized.includes("die")) return ["物量", "高速"];
  if (normalized.includes("castle") || normalized.includes("heliocentrism")) return ["階段", "低速"];
  if (normalized.includes("lamia") || normalized.includes("megingjord")) return ["物量", "乱打"];
  if (normalized.includes("stream") || normalized.includes("melody")) return ["ハネリズム", "同時押し"];
  return ["未分類"];
}

async function fetchVArchive(button: 4 | 5 | 6 | 8) {
  const sourceUrl = `https://v-archive.net/djpower/${button}`;
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`V-ARCHIVE returned ${response.status}`);
    const html = await response.text();
    const songs: CatalogSong[] = [];
    const songPattern = /href=["']\/db\/title\/(\d+)["'][^>]*>([^<]+)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = songPattern.exec(html)) !== null && songs.length < 800) {
      const id = match[1];
      const title = normalizeTitle(match[2].replace(/&amp;/g, "&"));
      const context = html.slice(Math.max(0, match.index - 8000), match.index);
      const levelMatches = [...context.matchAll(/<h4[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/h4>/gi)];
      const level = levelMatches.length ? Number(levelMatches[levelMatches.length - 1][1]) : null;
      if (level === null || songs.some((song) => song.id === id && song.unofficialDifficulty === level)) continue;
      songs.push({
        id: `${button}b-${id}-${level}`,
        title,
        artist: "V-ARCHIVE",
        chart: `${button}B`,
        officialDifficulty: null,
        unofficialDifficulty: level,
        pack: "V-ARCHIVE",
        chartTags: guessTags(title),
        sourceUrl: `https://v-archive.net/db/title/${id}`,
      });
    }
    if (!songs.length) throw new Error("No catalog rows were parsed");
    return { songs, source: "v-archive" as const, sourceUrl, fetchedAt: new Date().toISOString() };
  } catch {
    return { songs: fallbackSongs.map((song) => ({ ...song, chart: `${button}B` })), source: "fallback" as const, sourceUrl, fetchedAt: new Date().toISOString() };
  }
}

async function getCatalog(button: 4 | 5 | 6 | 8) {
  const cached = catalogCache.get(button);
  if (cached) return cached;
  const catalog = await fetchVArchive(button);
  catalogCache.set(button, catalog);
  return catalog;
}

function availableSongs(session: InternalSession, catalog: CatalogSong[]) {
  const current = session.rounds[session.currentRound];
  if (!current) return [];
  const selected = new Set(session.selectedPacks);
  return catalog.filter(
    (song) =>
      (selected.size === 0 || selected.has(song.pack)) &&
      session.p1Owned.includes(song.pack) &&
      session.p2Owned.includes(song.pack) &&
      song.unofficialDifficulty >= current.lower &&
      song.unofficialDifficulty <= current.upper &&
      (!current.tag || song.chartTags.includes(current.tag)),
  );
}

router.get("/catalog/:button", async (req, res) => {
  const parsed = GetDifficultyCatalogParams.safeParse({ button: Number(req.params.button) });
  if (!parsed.success) {
    res.status(400).json({ error: "ボタン数は4・5・6・8のいずれかです" });
    return;
  }
  const catalog = await getCatalog(parsed.data.button);
  res.json({
    ...catalog,
    sourceUrl: `https://v-archive.net/djpower/${parsed.data.button}`,
  });
});

router.post("/sessions", async (req, res) => {
  const parsed = CreateMatchSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "対戦設定を確認してください" });
    return;
  }
  const input = parsed.data;
  const session: InternalSession = {
    key: makeKey(),
    hostToken: makeToken(),
    guestToken: null,
    p1: input.playerName,
    p2: null,
    status: "waiting",
    button: input.button as 4 | 5 | 6 | 8,
    centerDifficulty: input.centerDifficulty,
    lowerOffset: input.lowerOffset,
    upperOffset: input.upperOffset,
    p1Owned: input.p1Owned,
    p2Owned: input.p2Owned,
    selectedPacks: input.selectedPacks,
    currentRound: 0,
    rounds: roundRange(input.centerDifficulty, input.lowerOffset, input.upperOffset),
    updatedAt: new Date().toISOString(),
  };
  await saveSession(session);
  res.status(201).json(responseFor(session, session.hostToken));
});

router.get("/sessions/:key", async (req, res) => {
  const session = await readSession(req.params.key.toUpperCase());
  if (!session) {
    res.status(404).json({ error: "セッションが見つかりません" });
    return;
  }
  res.json(responseFor(session, req.header("x-session-player")));
});

router.post("/sessions/:key", async (req, res) => {
  const key = req.params.key.toUpperCase();
  const session = await readSession(key);
  const parsed = JoinMatchSessionBody.safeParse(req.body);
  if (!session) {
    res.status(404).json({ error: "セッションが見つかりません" });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "プレイヤー名を入力してください" });
    return;
  }
  if (session.guestToken && session.p2) {
    res.status(409).json({ error: "このセッションはすでに満員です" });
    return;
  }
  session.p2 = parsed.data.playerName;
  session.guestToken = makeToken();
  session.status = "setup";
  await saveSession(session);
  res.json(responseFor(session, session.guestToken));
});

router.post("/sessions/:key/actions", async (req, res) => {
  const key = req.params.key.toUpperCase();
  const session = await readSession(key);
  if (!session) {
    res.status(404).json({ error: "セッションが見つかりません" });
    return;
  }
  const parsed = ApplyMatchActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "操作内容を確認してください" });
    return;
  }
  const token = req.header("x-session-player");
  const role = roleFor(session, token);
  if (role === "full") {
    res.status(403).json({ error: "セッション参加後に操作してください" });
    return;
  }
  const input = parsed.data;
  const actor = input.player ?? (role === "host" ? "p1" : "p2");
  if (input.player && input.player !== actor) {
    res.status(403).json({ error: "相手の操作は相手の画面から行ってください" });
    return;
  }
  if (input.action === "set-setup") {
    if (session.status === "active" || session.status === "finished") {
      res.status(400).json({ error: "対戦開始後は設定を変更できません" });
      return;
    }
    if (input.button !== undefined) session.button = input.button as 4 | 5 | 6 | 8;
    if (input.centerDifficulty !== undefined) session.centerDifficulty = input.centerDifficulty;
    if (input.lowerOffset !== undefined) session.lowerOffset = input.lowerOffset;
    if (input.upperOffset !== undefined) session.upperOffset = input.upperOffset;
    if (input.p1Owned) session.p1Owned = input.p1Owned;
    if (input.p2Owned) session.p2Owned = input.p2Owned;
    if (input.selectedPacks) session.selectedPacks = input.selectedPacks;
    session.rounds = roundRange(session.centerDifficulty, session.lowerOffset, session.upperOffset);
  } else if (input.action === "start-match") {
    if (!session.p2) {
      res.status(400).json({ error: "相手の参加を待っています" });
      return;
    }
    session.status = "active";
  } else if (input.action === "draw-chart-tag") {
    const current = session.rounds[session.currentRound];
    const used = new Set(session.rounds.map((round) => round.tag).filter(Boolean));
    const choices = chartTags.filter((tag) => !used.has(tag));
    current.tag = input.selectedTag ?? choices[Math.floor(Math.random() * choices.length)] ?? chartTags[0];
  } else if (input.action === "use-strategy") {
    const current = session.rounds[session.currentRound];
    if (actor === "p1") current.p1Card = true;
    if (actor === "p2") current.p2Card = true;
    if (current.p1Card && current.p2Card) {
      current.pickedSongId = null;
      current.pickedSongTitle = null;
      current.resolved = false;
    } else {
      const catalog = await getCatalog(session.button);
      const songs = availableSongs(session, catalog.songs);
      const picked = songs[Math.floor(Math.random() * songs.length)];
      if (picked) {
        current.pickedSongId = picked.id;
        current.pickedSongTitle = picked.title;
      }
      current.resolved = false;
    }
  } else if (input.action === "resolve-strategy") {
    const current = session.rounds[session.currentRound];
    if (current.p1Card && current.p2Card) {
      current.pickedSongId = null;
      current.pickedSongTitle = null;
    }
    current.resolved = true;
  } else if (input.action === "pick-song") {
    const current = session.rounds[session.currentRound];
    const catalog = await getCatalog(session.button);
    const picked = availableSongs(session, catalog.songs).find((song) => song.id === input.songId);
    if (!picked) {
      res.status(400).json({ error: "その曲は現在のカタログにありません" });
      return;
    }
    current.pickedSongId = picked.id;
    current.pickedSongTitle = picked.title;
  } else if (input.action === "advance-round") {
    if (session.currentRound >= session.rounds.length - 1) {
      session.status = "finished";
    } else {
      session.currentRound += 1;
    }
  } else if (input.action === "reset-match") {
    session.status = session.p2 ? "setup" : "waiting";
    session.currentRound = 0;
    session.rounds = roundRange(session.centerDifficulty, session.lowerOffset, session.upperOffset);
  }
  await saveSession(session);
  res.json(responseFor(session, token));
});

export default router;