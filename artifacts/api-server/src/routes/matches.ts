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

// Difficulty tiers from hardest to easiest. V-ARCHIVE's 서열표 (ranking table)
// covers all four; MAX DJ POWER (the old endpoint) only covered SC.
type Tier = "SC" | "MX" | "HD" | "NM";
const ALL_TIERS: Tier[] = ["SC", "MX", "HD", "NM"];
const DEFAULT_TIERS: Tier[] = ["SC"];

// Official DJMAX RESPECT V DLC pack codes, as used on V-ARCHIVE's 서열표.
// Codes we haven't confirmed (mostly one-off collaboration packs) fall back
// to their raw V-ARCHIVE code so nothing is silently dropped or mislabeled.
const DLC_PACKS: Record<string, { id: string; label: string }> = {
  R: { id: "respect", label: "RESPECT（本体収録）" },
  VE: { id: "v-extension-1", label: "V EXTENSION" },
  VE2: { id: "v-extension-2", label: "V EXTENSION 2" },
  VE3: { id: "v-extension-3", label: "V EXTENSION 3" },
  VE4: { id: "v-extension-4", label: "V EXTENSION 4" },
  VE5: { id: "v-extension-5", label: "V EXTENSION 5" },
  VL: { id: "v-liberty-1", label: "V LIBERTY" },
  VL2: { id: "v-liberty-2", label: "V LIBERTY 2" },
  VL3: { id: "v-liberty-3", label: "V LIBERTY 3" },
  VL4: { id: "v-liberty-4", label: "V LIBERTY 4" },
  VL5: { id: "v-liberty-5", label: "V LIBERTY 5" },
  T1: { id: "technika-1", label: "TECHNIKA" },
  T2: { id: "technika-2", label: "TECHNIKA 2" },
  T3: { id: "technika-3", label: "TECHNIKA 3" },
  BS: { id: "black-square", label: "BLACK SQUARE" },
  P3: { id: "portable-3", label: "PORTABLE 3" },
};

function resolvePack(rawCode: string): { pack: string; packLabel: string } {
  const known = DLC_PACKS[rawCode];
  if (known) return { pack: known.id, packLabel: known.label };
  // Unknown / unmapped code (mostly one-off collab packs): keep the raw
  // V-ARCHIVE code so songs still group together instead of disappearing.
  return { pack: rawCode || "unknown", packLabel: rawCode || "その他コラボ" };
}

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
  tier: Tier;
  officialDifficulty: number | null;
  unofficialDifficulty: number;
  pack: string;
  packLabel: string;
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
  p1SongId: string | null;
  p1SongTitle: string | null;
  p2SongId: string | null;
  p2SongTitle: string | null;
  revealed: boolean;
  strategyOutcome: "none" | "random" | "cancelled";
  strategyEventId: string | null;
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
  includeTiers: Tier[];
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

// [id, title, packCode, tier, level, tags] — packCode/tier/level are sourced
// from V-ARCHIVE's 서열표 (grade table) so the offline fallback still reflects
// real official DLC packs and includes MX-tier (not just SC-tier) charts.
const fallbackSongs: CatalogSong[] = (
  [
    ["733", "#1f1e33", "ARC", "SC", 15.2, ["階段", "乱打"]],
    ["654", "1! 2! 3! 4! Streaming rn CHU!", "VL2", "SC", 15.2, ["同時押し", "ハネリズム"]],
    ["553", "DIE IN", "VE4", "SC", 16.1, ["物量", "高速"]],
    ["553", "DIE IN", "VE4", "MX", 15.2, ["物量", "高速"]],
    ["756", "Heliocentrism", "VL4", "SC", 15.3, ["階段", "高速"]],
    ["544", "LIMBO", "EZ2", "SC", 15.2, ["低速", "混合"]],
    ["544", "LIMBO", "EZ2", "MX", 14.2, ["低速", "混合"]],
    ["81", "Nightmare", "P2", "SC", 15.3, ["物量", "乱打"]],
    ["476", "PUPA", "MD", "SC", 15.2, ["乱打", "高速"]],
    ["476", "PUPA", "MD", "MX", 15.1, ["乱打", "高速"]],
    ["722", "PUPA (xi Remix)", "RV", "SC", 15.2, ["乱打", "トリル"]],
    ["713", "Rise Up", "VL3", "SC", 15.2, ["物量", "同時押し"]],
    ["767", "The Castle of Báthory", "VL4", "SC", 15.2, ["低速", "階段"]],
    ["767", "The Castle of Báthory", "VL4", "MX", 15.1, ["低速", "階段"]],
    ["524", "Zero-Break", "VE3", "SC", 15.3, ["物量", "ハネリズム"]],
    ["545", "Zeroize", "EZ2", "SC", 15.2, ["トリル", "高速"]],
    ["545", "Zeroize", "EZ2", "MX", 14.1, ["トリル", "高速"]],
    ["783", "And Revive The Melody", "OGK", "SC", 15.2, ["ハネリズム", "同時押し"]],
    ["789", "LAMIA", "OGK", "SC", 15.3, ["物量", "高速"]],
    ["789", "LAMIA", "OGK", "MX", 15.1, ["物量", "高速"]],
    ["794", "MEGATØNiX PHANTØM", "CP", "SC", 15.2, ["乱打", "混合"]],
    ["815", "Megingjord", "VL5", "SC", 15.2, ["物量", "階段"]],
    ["815", "Megingjord", "VL5", "MX", 15.1, ["物量", "階段"]],
    ["807", "RE;DIEIN", "VL5", "SC", 15.2, ["乱打", "高速"]],
    ["810", "Sleipnir", "VL5", "SC", 15.2, ["トリル", "高速"]],
    ["810", "Sleipnir", "VL5", "MX", 15.2, ["トリル", "高速"]],
  ] as const
).map(([id, title, packCode, tier, level, tags]) => {
  const { pack, packLabel } = resolvePack(packCode);
  return {
    id: `${id}-${tier}`,
    title: String(title),
    artist: "V-ARCHIVE",
    chart: packCode,
    tier: tier as Tier,
    officialDifficulty: null,
    unofficialDifficulty: Number(level),
    pack,
    packLabel,
    chartTags: tags as unknown as ChartTag[],
    sourceUrl: `https://v-archive.net/db/title/${id}`,
  };
});

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
      p1SongId: null,
      p1SongTitle: null,
      p2SongId: null,
      p2SongTitle: null,
      revealed: false,
      strategyOutcome: "none",
      strategyEventId: null,
    },
    {
      label: "MID",
      lower: lowBoundary,
      upper: highBoundary,
      tag: null,
      p1Card: false,
      p2Card: false,
      resolved: false,
      p1SongId: null,
      p1SongTitle: null,
      p2SongId: null,
      p2SongTitle: null,
      revealed: false,
      strategyOutcome: "none",
      strategyEventId: null,
    },
    {
      label: "HIGH",
      lower: highBoundary,
      upper: Number(Math.min(20, center + upperOffset).toFixed(1)),
      tag: null,
      p1Card: false,
      p2Card: false,
      resolved: false,
      p1SongId: null,
      p1SongTitle: null,
      p2SongId: null,
      p2SongTitle: null,
      revealed: false,
      strategyOutcome: "none",
      strategyEventId: null,
    },
  ];
}

function roleFor(session: InternalSession, token: string | undefined) {
  if (token && token === session.hostToken) return "host" as const;
  if (token && token === session.guestToken) return "guest" as const;
  return "full" as const;
}

function responseFor(session: InternalSession, token: string | undefined) {
  const role = roleFor(session, token);
  const player = role === "guest" ? "p2" : role === "host" ? "p1" : null;
  return {
    key: session.key,
    role,
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
    includeTiers: session.includeTiers?.length ? session.includeTiers : DEFAULT_TIERS,
    currentRound: session.currentRound,
    rounds: session.rounds.map((round) => ({
      label: round.label,
      lower: round.lower,
      upper: round.upper,
      tag: round.tag,
      p1Card: round.p1Card,
      p2Card: round.p2Card,
      resolved: round.resolved,
      mySongId: player === "p1" ? round.p1SongId : player === "p2" ? round.p2SongId : null,
      mySongTitle: player === "p1" ? round.p1SongTitle : player === "p2" ? round.p2SongTitle : null,
      opponentSongTitle: round.revealed
        ? player === "p1"
          ? round.p2SongTitle
          : player === "p2"
            ? round.p1SongTitle
            : null
        : null,
      revealed: round.revealed,
      strategyOutcome: round.strategyOutcome,
      strategyEventId: round.strategyEventId,
    })),
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

// V-ARCHIVE's MAX DJ POWER page (djpower) only lists SC-tier charts. The
// 서열표 (grade / ranking table) page covers SC/MX/HD/NM for every level, and
// also prints each song's DLC pack code, so we use that instead.
async function fetchVArchive(button: 4 | 5 | 6 | 8) {
  const sourceUrl = `https://v-archive.net/grade/${button}/ALL`;
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`V-ARCHIVE returned ${response.status}`);
    const html = await response.text();
    const songs: CatalogSong[] = [];
    const songPattern = /href=["']\/db\/title\/(\d+)["'][^>]*>([^<]+)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = songPattern.exec(html)) !== null && songs.length < 2000) {
      const id = match[1];
      const title = normalizeTitle(match[2].replace(/&amp;/g, "&"));
      // Best-effort: look at the markup immediately around each song link for
      // its tier (SC/MX/HD/NM), level, and DLC pack code. V-ARCHIVE doesn't
      // publish a stable API for this, so if their markup changes this may
      // need retuning — it always falls back to the offline catalog below.
      const context = html.slice(Math.max(0, match.index - 400), match.index);
      const levelMatches = [...context.matchAll(/<h4[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/h4>/gi)];
      const level = levelMatches.length ? Number(levelMatches[levelMatches.length - 1][1]) : null;
      const tierMatches = [...context.matchAll(/\b(SC|MX|HD|NM)\b/g)];
      const tier = (tierMatches.length ? tierMatches[tierMatches.length - 1][1] : "SC") as Tier;
      const packMatches = [...context.matchAll(/>\s*([A-Z]{1,4}[0-9]?)\s*<\/[a-z]+>\s*(?:<[^>]+>\s*)*$/gi)];
      const packCode = packMatches.length ? packMatches[packMatches.length - 1][1] : "R";
      if (level === null) continue;
      const dedupeKey = `${id}-${tier}`;
      if (songs.some((song) => song.id === dedupeKey)) continue;
      const { pack, packLabel } = resolvePack(packCode);
      songs.push({
        id: dedupeKey,
        title,
        artist: "V-ARCHIVE",
        chart: `${button}B`,
        tier,
        officialDifficulty: null,
        unofficialDifficulty: level,
        pack,
        packLabel,
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
  const tiers = new Set(session.includeTiers?.length ? session.includeTiers : DEFAULT_TIERS);
  return catalog.filter(
    (song) =>
      tiers.has(song.tier) &&
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
  res.json(catalog);
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
    includeTiers: (input.includeTiers?.length ? input.includeTiers : DEFAULT_TIERS) as Tier[],
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
    if (input.includeTiers?.length) session.includeTiers = input.includeTiers as Tier[];
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
    if (current.resolved || current.revealed) {
      res.status(400).json({ error: "このラウンドのカード処理は完了しています" });
      return;
    }
    if ((actor === "p1" && current.p1Card) || (actor === "p2" && current.p2Card)) {
      res.status(400).json({ error: "ストラテジーはすでに使用済みです" });
      return;
    }
    if (actor === "p1") current.p1Card = true;
    if (actor === "p2") current.p2Card = true;
    current.strategyEventId = makeToken();
    if (current.p1Card && current.p2Card) {
      current.p1SongId = null;
      current.p1SongTitle = null;
      current.p2SongId = null;
      current.p2SongTitle = null;
      current.revealed = false;
      current.strategyOutcome = "cancelled";
      current.resolved = false;
    } else {
      const catalog = await getCatalog(session.button);
      const songs = availableSongs(session, catalog.songs);
      const picked = songs[Math.floor(Math.random() * songs.length)];
      if (picked) {
        if (actor === "p1") {
          current.p1SongId = picked.id;
          current.p1SongTitle = picked.title;
        } else {
          current.p2SongId = picked.id;
          current.p2SongTitle = picked.title;
        }
      }
      current.strategyOutcome = "random";
      current.revealed = Boolean(current.p1SongId && current.p2SongId);
      current.resolved = false;
    }
  } else if (input.action === "resolve-strategy") {
    const current = session.rounds[session.currentRound];
    if (current.p1Card && current.p2Card) {
      current.p1Card = false;
      current.p2Card = false;
      current.strategyEventId = makeToken();
      current.strategyOutcome = "cancelled";
      current.revealed = false;
    }
    current.resolved = true;
  } else if (input.action === "pick-song") {
    const current = session.rounds[session.currentRound];
    if (current.revealed) {
      res.status(400).json({ error: "選曲公開後は変更できません" });
      return;
    }
    if ((actor === "p1" && current.p1Card) || (actor === "p2" && current.p2Card)) {
      res.status(400).json({ error: "ストラテジー使用中は手動選曲できません" });
      return;
    }
    const catalog = await getCatalog(session.button);
    const picked = availableSongs(session, catalog.songs).find((song) => song.id === input.songId);
    if (!picked) {
      res.status(400).json({ error: "その曲は現在のカタログにありません" });
      return;
    }
    if (actor === "p1") {
      current.p1SongId = picked.id;
      current.p1SongTitle = picked.title;
    } else {
      current.p2SongId = picked.id;
      current.p2SongTitle = picked.title;
    }
    current.revealed = Boolean(current.p1SongId && current.p2SongId);
    current.resolved = false;
  } else if (input.action === "advance-round") {
    const current = session.rounds[session.currentRound];
    if (!current?.revealed) {
      res.status(400).json({ error: "両者が選曲を終えるまで次へ進めません" });
      return;
    }
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