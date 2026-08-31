import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleDot,
  Dices,
  Gamepad2,
  Gauge,
  Layers3,
  LockKeyhole,
  Minus,
  RotateCcw,
  Shield,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type Dlc = { id: string; name: string; short: string; songs: number; color: string };
type Band = { id: string; label: string; low: number; high: number; tone: string };
type Song = { title: string; artist: string; level: number; genre: string; dlc: string };
type Round = { label: string; sub: string; band: string; genre: string; p1Card: boolean; p2Card: boolean; resolved: boolean };
type Match = { p1: string; p2: string; pool: string[]; bandId: string; rounds: Round[]; current: number };

const DLCS: Dlc[] = [
  { id: 'respect', name: 'RESPECT', short: 'RES', songs: 12, color: '#f4c84d' },
  { id: 'v', name: 'V EXTENSION', short: 'V', songs: 9, color: '#42d4dc' },
  { id: 'black', name: 'BLACK SQUARE', short: 'BS', songs: 7, color: '#ee6f9a' },
  { id: 'technika', name: 'TECHNIKA', short: 'TK', songs: 8, color: '#b18cff' },
];

const BANDS: Band[] = [
  { id: 'low', label: 'LOW', low: 1, high: 5, tone: '序盤は精度と読み合い' },
  { id: 'mid', label: 'MID', low: 6, high: 10, tone: 'ここから本番、選曲が刺さる' },
  { id: 'high', label: 'HIGH', low: 11, high: 15, tone: '最後に残るのは地力だけ' },
];

const SONGS: Song[] = [
  { title: 'Glory Day', artist: 'BEXTER', level: 4, genre: 'ポップ', dlc: 'respect' },
  { title: 'U.A.D', artist: 'HAYAKO', level: 5, genre: 'エレクトロ', dlc: 'respect' },
  { title: 'Black Cat', artist: 'Nauts', level: 6, genre: 'ロック', dlc: 'black' },
  { title: 'Waiting for you', artist: 'DyoN Joo', level: 7, genre: 'ポップ', dlc: 'respect' },
  { title: 'Misty Er’A', artist: 'm2u', level: 8, genre: 'トランス', dlc: 'technika' },
  { title: 'The Clear Blue Sky', artist: 'Tsukasa', level: 9, genre: 'トランス', dlc: 'technika' },
  { title: 'Vile Requiem', artist: 'Nauts', level: 10, genre: 'クラシック', dlc: 'black' },
  { title: 'The Feelings', artist: 'NieN', level: 11, genre: 'エレクトロ', dlc: 'v' },
  { title: 'Lacheln', artist: 'Eye DT', level: 12, genre: 'ハードコア', dlc: 'v' },
  { title: 'Mulch', artist: 'MAD SOXX', level: 13, genre: 'ブレイクス', dlc: 'v' },
  { title: 'Fermion', artist: 'Makou', level: 14, genre: 'ハードコア', dlc: 'respect' },
  { title: 'Black Swan', artist: 'Nauts', level: 15, genre: 'クラシック', dlc: 'black' },
];

const GENRES = ['ポップ', 'エレクトロ', 'ロック', 'トランス', 'ハードコア', 'クラシック', 'ブレイクス'];
const STORAGE_KEY = 'djmax-bpl-match-v1';
const SETUP_KEY = 'djmax-bpl-setup-v1';

const freshRounds = (): Round[] => [
  { label: 'LOW', sub: 'ROUND 01', band: '1 — 5', genre: '', p1Card: false, p2Card: false, resolved: false },
  { label: 'MID', sub: 'ROUND 02', band: '6 — 10', genre: '', p1Card: false, p2Card: false, resolved: false },
  { label: 'HIGH', sub: 'ROUND 03', band: '11 — 15', genre: '', p1Card: false, p2Card: false, resolved: false },
];

const defaultSetup = {
  p1: 'PLAYER 01',
  p2: 'PLAYER 02',
  dlcs: DLCS.reduce<Record<string, boolean>>((acc, dlc) => ({ ...acc, [dlc.id]: true }), {}),
  p1Owned: DLCS.reduce<Record<string, boolean>>((acc, dlc) => ({ ...acc, [dlc.id]: true }), {}),
  p2Owned: DLCS.reduce<Record<string, boolean>>((acc, dlc) => ({ ...acc, [dlc.id]: true }), {}),
  bandId: 'low',
};

function loadMatch(): Match | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as Match : null;
  } catch {
    return null;
  }
}

function loadSetup() {
  try {
    const value = localStorage.getItem(SETUP_KEY);
    const parsed = value ? JSON.parse(value) : {};
    return { ...defaultSetup, ...parsed, dlcs: { ...defaultSetup.dlcs, ...parsed.dlcs }, p1Owned: { ...defaultSetup.p1Owned, ...parsed.p1Owned }, p2Owned: { ...defaultSetup.p2Owned, ...parsed.p2Owned } };
  } catch {
    return defaultSetup;
  }
}

function AppShell() {
  const [match, setMatch] = useState<Match | null>(() => loadMatch());
  const [setup, setSetup] = useState(() => loadSetup());
  const [genreFlash, setGenreFlash] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (match) localStorage.setItem(STORAGE_KEY, JSON.stringify(match));
    else localStorage.removeItem(STORAGE_KEY);
  }, [match]);

  useEffect(() => {
    if (!match) localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  }, [setup, match]);

  const selectedDlcIds = useMemo(() => Object.entries(setup.dlcs).filter(([, selected]) => selected).map(([id]) => id), [setup.dlcs]);
  const poolSongs = useMemo(() => SONGS.filter((song) => selectedDlcIds.includes(song.dlc)), [selectedDlcIds]);
  const selectedBand = BANDS.find((band) => band.id === setup.bandId) ?? BANDS[0];

  const persistTick = () => {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  const startMatch = () => {
    const rounds = freshRounds().map((round, index) => ({
      ...round,
      band: `${BANDS[index].low} — ${BANDS[index].high}`,
    }));
    const next: Match = { p1: setup.p1.trim() || 'PLAYER 01', p2: setup.p2.trim() || 'PLAYER 02', pool: selectedDlcIds, bandId: setup.bandId, rounds, current: 0 };
    setMatch(next);
    persistTick();
  };

  const resetMatch = () => {
    setMatch(null);
    setSetup(defaultSetup);
  };

  const randomizeGenre = () => {
    if (!match) return;
    const used = match.rounds.map((round) => round.genre).filter(Boolean);
    const candidates = GENRES.filter((genre) => !used.includes(genre));
    const genre = candidates[Math.floor(Math.random() * candidates.length)] ?? GENRES[Math.floor(Math.random() * GENRES.length)];
    const rounds = match.rounds.map((round, index) => index === match.current ? { ...round, genre } : round);
    setMatch({ ...match, rounds });
    setGenreFlash(true);
    window.setTimeout(() => setGenreFlash(false), 500);
    persistTick();
  };

  const toggleStrategy = (player: 'p1Card' | 'p2Card') => {
    if (!match) return;
    const rounds = match.rounds.map((round, index) => index === match.current ? { ...round, [player]: !round[player] } : round);
    setMatch({ ...match, rounds });
    persistTick();
  };

  const resolveStrategy = () => {
    if (!match) return;
    const rounds = match.rounds.map((round, index) => index === match.current ? { ...round, resolved: true } : round);
    setMatch({ ...match, rounds });
    persistTick();
  };

  const advanceRound = () => {
    if (!match || match.current >= match.rounds.length - 1) return;
    setMatch({ ...match, current: match.current + 1 });
    persistTick();
  };

  return match ? (
    <MatchView match={match} genreFlash={genreFlash} saved={saved} onBack={() => setMatch(null)} onReset={resetMatch} onGenre={randomizeGenre} onStrategy={toggleStrategy} onResolve={resolveStrategy} onAdvance={advanceRound} />
  ) : (
    <SetupView setup={setup} selectedBand={selectedBand} selectedDlcIds={selectedDlcIds} poolSongs={poolSongs} saved={saved} onSetup={setSetup} onStart={startMatch} />
  );
}

function Mark({ small = false }: { small?: boolean }) {
  return <div className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true"><span /><span /><span /></div>;
}

function Header({ active = false, onReset, saved }: { active?: boolean; onReset?: () => void; saved: boolean }) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <Mark />
        <div><div className="brand-name">DJMAX / BPL 管制室</div><div className="brand-caption">対戦管理システム</div></div>
      </div>
      <div className="topbar-right">
        <div className="live-status"><span className="live-dot" />{active ? '対戦中' : '準備完了'}</div>
        {saved && <div className="saved-note"><Check size={13} /> 保存済み</div>}
        {active && <button className="text-button" onClick={onReset} data-testid="button-reset-match"><RotateCcw size={15} /> セットアップへ戻る</button>}
      </div>
    </header>
  );
}

function SetupView({ setup, selectedBand, selectedDlcIds, poolSongs, saved, onSetup, onStart }: {
  setup: typeof defaultSetup; selectedBand: Band; selectedDlcIds: string[]; poolSongs: Song[]; saved: boolean;
  onSetup: (value: typeof defaultSetup) => void; onStart: () => void;
}) {
  const toggleDlc = (id: string) => onSetup({ ...setup, dlcs: { ...setup.dlcs, [id]: !setup.dlcs[id] } });
  const toggleOwnership = (player: 'p1Owned' | 'p2Owned', id: string) => {
    const nextOwned = !setup[player][id];
    onSetup({
      ...setup,
      [player]: { ...setup[player], [id]: nextOwned },
      dlcs: nextOwned || !setup.dlcs[id] ? setup.dlcs : { ...setup.dlcs, [id]: false },
    });
  };
  return (
    <main className="app-frame">
      <Header saved={saved} />
      <div className="setup-layout">
        <section className="setup-hero">
          <div className="eyebrow"><CircleDot size={13} /> 対戦準備 / 001</div>
          <h1>勝負の前に、<br /><em>盤面</em>を決める。</h1>
          <p className="hero-copy">2人だけのセッションを、公式戦の緊張感で。<br />DLC、難易度、ストラテジーをここでロックイン。</p>
          <div className="hero-grid-lines" aria-hidden="true" />
          <div className="hero-note"><span className="mono">ローカルセッション</span><span>データはこのブラウザに保存されます</span></div>
        </section>
        <section className="setup-panel">
          <div className="section-heading"><div><div className="kicker">01 / 対戦者</div><h2>対戦者を登録</h2></div><div className="step-count">1 / 3</div></div>
          <div className="player-fields">
            <label className="player-field player-one"><span>プレイヤー 01</span><div className="field-wrap"><input value={setup.p1} onChange={(event) => onSetup({ ...setup, p1: event.target.value })} data-testid="input-player-one" maxLength={18} /><Swords size={18} /></div></label>
            <div className="versus">VS</div>
            <label className="player-field player-two"><span>プレイヤー 02</span><div className="field-wrap"><input value={setup.p2} onChange={(event) => onSetup({ ...setup, p2: event.target.value })} data-testid="input-player-two" maxLength={18} /><Swords size={18} /></div></label>
          </div>

          <div className="ownership-block">
            <div className="ownership-title"><div className="kicker">DLC 所持状況</div><span>両者が所持するDLCだけ共有プールへ追加できます</span></div>
            <div className="ownership-grid">
              <div className="ownership-header"><span>所持状況</span>{DLCS.map((dlc) => <span key={dlc.id} style={{ color: dlc.color }}>{dlc.short}</span>)}</div>
              <div className="ownership-row"><strong><i className="owner-dot owner-one" />{setup.p1 || 'PLAYER 01'}</strong>{DLCS.map((dlc) => <button key={dlc.id} className={`owner-toggle ${setup.p1Owned[dlc.id] ? 'is-owned' : ''}`} onClick={() => toggleOwnership('p1Owned', dlc.id)} aria-pressed={setup.p1Owned[dlc.id]} data-testid={`button-player-one-dlc-${dlc.id}`}>{setup.p1Owned[dlc.id] ? <Check size={12} /> : <Minus size={12} />}</button>)}</div>
              <div className="ownership-row"><strong><i className="owner-dot owner-two" />{setup.p2 || 'PLAYER 02'}</strong>{DLCS.map((dlc) => <button key={dlc.id} className={`owner-toggle ${setup.p2Owned[dlc.id] ? 'is-owned' : ''}`} onClick={() => toggleOwnership('p2Owned', dlc.id)} aria-pressed={setup.p2Owned[dlc.id]} data-testid={`button-player-two-dlc-${dlc.id}`}>{setup.p2Owned[dlc.id] ? <Check size={12} /> : <Minus size={12} />}</button>)}</div>
            </div>
          </div>

          <div className="section-heading section-heading-spaced"><div><div className="kicker">02 / 共有プール</div><h2>使用するDLC</h2></div><span className="pool-count" data-testid="text-selected-dlc-count">{selectedDlcIds.length} / {DLCS.length} 選択中 ・ {poolSongs.length} 曲</span></div>
          <div className="dlc-grid">
            {DLCS.map((dlc) => {
              const selected = setup.dlcs[dlc.id];
              const shared = setup.p1Owned[dlc.id] && setup.p2Owned[dlc.id];
              return <button key={dlc.id} className={`dlc-card ${selected ? 'is-selected' : ''} ${!shared ? 'is-locked' : ''}`} onClick={() => toggleDlc(dlc.id)} disabled={!shared} data-testid={`button-toggle-dlc-${dlc.id}`} aria-pressed={selected}>
                <span className="dlc-stripe" style={{ background: dlc.color }} /><span className="dlc-code">{dlc.short}</span><span className="dlc-name">{dlc.name}</span><span className="dlc-songs">{dlc.songs} 曲</span><span className="check-box">{selected && <Check size={13} />}</span>
              </button>;
            })}
          </div>

          <div className="section-heading section-heading-spaced"><div><div className="kicker">03 / DIFFICULTY BAND</div><h2>公式帯域を選択</h2></div><div className="active-band" data-testid="text-active-band"><Gauge size={15} /> {selectedBand.label}</div></div>
          <div className="band-row">
            {BANDS.map((band) => <button key={band.id} className={`band-option ${setup.bandId === band.id ? 'is-selected' : ''}`} onClick={() => onSetup({ ...setup, bandId: band.id })} data-testid={`button-band-${band.id}`}><span className="band-label">{band.label}</span><span className="band-range">{band.low} — {band.high}</span><span className="band-tone">{band.tone}</span>{setup.bandId === band.id && <span className="band-selected"><Check size={13} /></span>}</button>)}
          </div>
          <div className="setup-footer"><div className="catalog-note"><AlertTriangle size={15} /><span>曲目カタログは編集可能なデモデータです。<br />公式APIとの同期はありません。</span></div><button className="primary-button start-button" onClick={onStart} disabled={selectedDlcIds.length === 0} data-testid="button-start-match">対戦を開始 <ChevronRight size={19} /></button></div>
        </section>
      </div>
      <footer className="site-footer"><span>DJMAX RESPECT V / BPL スタイルセッション</span><span className="mono">ローカル版 v1.0</span></footer>
    </main>
  );
}

function MatchView({ match, genreFlash, saved, onBack, onReset, onGenre, onStrategy, onResolve, onAdvance }: {
  match: Match; genreFlash: boolean; saved: boolean; onBack: () => void; onReset: () => void; onGenre: () => void; onStrategy: (player: 'p1Card' | 'p2Card') => void; onResolve: () => void; onAdvance: () => void;
}) {
  const round = match.rounds[match.current];
  const currentBand = BANDS[match.current];
  const bothCards = round.p1Card && round.p2Card;
  const cardsResolved = bothCards && round.resolved;
  const roundSongs = SONGS.filter((song) => match.pool.includes(song.dlc) && song.level >= currentBand.low && song.level <= currentBand.high);
  return (
    <main className="app-frame match-app">
      <Header active saved={saved} onReset={onReset} />
      <div className="match-head">
        <button className="back-button" onClick={onBack} data-testid="button-back-setup"><ArrowLeft size={16} /> セットアップ</button>
        <div className="match-title"><div className="eyebrow"><span className="live-dot" /> 対戦中 / ライブボード</div><h1>{match.p1} <span>対</span> {match.p2}</h1></div>
        <div className="match-meta"><span>セッションID</span><strong className="mono">BPL-{String(match.pool.length * 137 + 24).padStart(4, '0')}</strong></div>
      </div>
      <div className="round-track">
        {match.rounds.map((item, index) => <div key={item.label} className={`round-node ${index === match.current ? 'is-current' : ''} ${index < match.current ? 'is-done' : ''}`}><div className="round-line"><span /></div><div className="round-index">0{index + 1}</div><div className="round-copy"><strong>{item.label}</strong><span>{item.sub.replace('ROUND', 'ラウンド')}</span></div>{index === match.current && <span className="now-tag">対戦中</span>}</div>)}
      </div>
      <div className="match-content">
        <section className="board-main">
          <div className="board-flag"><span>{currentBand.label} / ラウンド 0{match.current + 1}</span><span className="mono">難易度 {currentBand.low} — {currentBand.high}</span></div>
          <div className={`genre-stage ${genreFlash ? 'is-flashing' : ''}`}>
            <div className="genre-decor decor-left">ジャンル<br />抽選</div>
            <div className="genre-center"><div className="kicker">このラウンドのジャンル</div><div className="genre-value" data-testid="text-current-genre">{round.genre || '未決定'}</div><div className="genre-sub">{round.genre ? 'このジャンルから選曲してください' : 'ボタンを押して抽選'}</div></div>
            <button className="draw-button" onClick={onGenre} data-testid="button-randomize-genre"><Dices size={20} /> ジャンルを引く</button>
          </div>
          <div className="song-pool-head"><div><span className="kicker">選曲可能曲 / デモカタログ</span><h2>選曲可能なトラック</h2></div><span className="track-total" data-testid="text-track-total">{roundSongs.length} 曲</span></div>
          <div className="song-list">
            {roundSongs.length ? roundSongs.map((song, index) => <div className="song-row" key={song.title} data-testid={`row-song-${index}`}><span className="song-num mono">{String(index + 1).padStart(2, '0')}</span><div className="song-info"><strong>{song.title}</strong><span>{song.artist}</span></div><span className="song-genre">{song.genre}</span><span className="song-level mono">SC {song.level}</span><button className="mini-action" onClick={onGenre} data-testid={`button-song-pick-${index}`}>候補にする</button></div>) : <div className="empty-state"><Layers3 size={22} /><span>この帯域のトラックがありません</span></div>}
          </div>
        </section>
        <aside className="board-side">
          <div className="side-card strategy-card">
            <div className="side-card-head"><div><div className="kicker">戦術レイヤー</div><h2>ストラテジー</h2></div><Shield size={20} /></div>
            <p className="side-description">同じラウンドで両者が使用すると、カードは相殺されます。</p>
            <div className="strategy-players">
              <StrategyPlayer name={match.p1} player="p1Card" active={round.p1Card} disabled={round.resolved} onUse={() => onStrategy('p1Card')} />
              <div className="card-vs">VS</div>
              <StrategyPlayer name={match.p2} player="p2Card" active={round.p2Card} disabled={round.resolved} onUse={() => onStrategy('p2Card')} />
            </div>
            <div className={`strategy-result ${cardsResolved ? 'is-resolved' : bothCards ? 'is-cancelled' : ''}`} data-testid="status-strategy">
              {cardsResolved ? <><Check size={17} /> 相殺を確定しました</> : bothCards ? <><Minus size={17} /> カード相殺 / 成立</> : <><LockKeyhole size={15} /> カードを選択して効果を公開</>}
            </div>
            {bothCards && !round.resolved && <button className="resolve-button" onClick={onResolve} data-testid="button-resolve-strategy">相殺を確定する <Check size={16} /></button>}
          </div>
          <div className="side-card rules-card"><div className="side-card-head"><div><div className="kicker">対戦プロトコル</div><h2>進行ルール</h2></div><Gamepad2 size={20} /></div><div className="rule-row"><span>01</span><p>各ラウンドのジャンルを抽選</p></div><div className="rule-row"><span>02</span><p>指定帯域から選曲してプレイ</p></div><div className="rule-row"><span>03</span><p>結果を記録して次の帯域へ</p></div></div>
          <button className="next-button" onClick={onAdvance} disabled={match.current >= match.rounds.length - 1} data-testid="button-advance-round">{match.current >= match.rounds.length - 1 ? <><Trophy size={19} /> セット完了</> : <>次のラウンドへ <ChevronRight size={19} /></>}</button>
          <button className="reset-link" onClick={onReset} data-testid="button-reset-match-side"><RotateCcw size={14} /> このセッションをリセット</button>
        </aside>
      </div>
    </main>
  );
}

function StrategyPlayer({ name, player, active, disabled, onUse }: { name: string; player: 'p1Card' | 'p2Card'; active: boolean; disabled: boolean; onUse: () => void }) {
  return <div className={`strategy-player ${active ? 'is-active' : ''}`}><div className="player-initial">{name.slice(0, 1)}</div><div className="strategy-name"><strong>{name}</strong><span>カード 01 / 01</span></div><button onClick={onUse} disabled={disabled} data-testid={`button-use-strategy-${player}`}>{active ? <><Check size={13} /> 使用中</> : <><Zap size={13} /> 使用する</>}</button></div>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={AppShell} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;