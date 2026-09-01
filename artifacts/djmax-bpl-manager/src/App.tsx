import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyMatchAction, createMatchSession, getDifficultyCatalog, getMatchSession, joinMatchSession } from '@workspace/api-client-react';
import type { CatalogSong, ChartTag, SessionActionInput, SessionCreateInput, SessionState } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Check, ChevronRight, Copy, Dices, ExternalLink, Gauge, Link2, LoaderCircle, LockKeyhole, LogIn, RefreshCw, RotateCcw, Shield, Swords, Trophy, UserPlus, Zap } from 'lucide-react';

const queryClient = new QueryClient();
const SESSION_KEY = 'djmax-bpl-session-key';
const TOKEN_KEY = 'djmax-bpl-session-token';
const SETUP_KEY = 'djmax-bpl-online-setup';
const TAGS: ChartTag[] = ['物量', 'ハネリズム', '階段', '乱打', 'トリル', '同時押し', '低速', '高速', '混合'];
const PACKS = [
  { id: 'V-ARCHIVE', label: 'V-ARCHIVE', sub: '非公式難易度カタログ', accent: 'yellow' },
  { id: 'respect', label: 'RESPECT', sub: 'デフォルト / 本体', accent: 'yellow' },
  { id: 'v', label: 'V EXTENSION', sub: 'DLC', accent: 'cyan' },
  { id: 'black', label: 'BLACK SQUARE', sub: 'DLC', accent: 'pink' },
  { id: 'technika', label: 'TECHNIKA', sub: 'DLC', accent: 'purple' },
];
type ButtonMode = 4 | 5 | 6 | 8;
type LocalSetup = { name: string; button: ButtonMode; center: number; lower: number; upper: number; p1Owned: string[]; p2Owned: string[]; selectedPacks: string[] };

const initialSetup: LocalSetup = { name: '', button: 4, center: 15, lower: 1, upper: 1, p1Owned: ['V-ARCHIVE'], p2Owned: ['V-ARCHIVE'], selectedPacks: ['V-ARCHIVE'] };
const requestWithToken = (token: string) => ({ headers: { 'x-session-player': token } });
const loadLocal = <T,>(key: string, fallback: T): T => {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><OnlineApp /><Toaster /></TooltipProvider></QueryClientProvider>;
}

function OnlineApp() {
  const [setup, setSetup] = useState<LocalSetup>(() => ({ ...initialSetup, ...loadLocal<Partial<LocalSetup>>(SETUP_KEY, {}) }));
  const [session, setSession] = useState<SessionState | null>(null);
  const [catalog, setCatalog] = useState<CatalogSong[]>([]);
  const [catalogSource, setCatalogSource] = useState<'v-archive' | 'fallback' | null>(null);
  const [sessionKey, setSessionKey] = useState(() => localStorage.getItem(SESSION_KEY) ?? '');
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '');
  const [joinKey, setJoinKey] = useState('');
  const [joinName, setJoinName] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [genreFlash, setGenreFlash] = useState(false);
  const [copied, setCopied] = useState(false);

  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2800); };
  const rememberSession = (next: SessionState) => {
    setSession(next); setSessionKey(next.key); setToken(next.clientToken);
    localStorage.setItem(SESSION_KEY, next.key); localStorage.setItem(TOKEN_KEY, next.clientToken);
  };
  const loadCatalog = async (button: ButtonMode) => {
    try {
      const result = await getDifficultyCatalog(button);
      setCatalog(result.songs); setCatalogSource(result.source);
    } catch { setCatalog([]); setCatalogSource(null); showNotice('V-ARCHIVEの取得に失敗しました'); }
  };
  useEffect(() => { if (session?.button) void loadCatalog(session.button as ButtonMode); else void loadCatalog(setup.button); }, [session?.button, setup.button]);
  useEffect(() => { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); }, [setup]);

  useEffect(() => {
    if (!sessionKey || !token) return;
    let active = true;
    const poll = async () => {
      try { const next = await getMatchSession(sessionKey, requestWithToken(token)); if (active) setSession(next); } catch { /* transient network failures are retried */ }
    };
    void poll();
    const id = window.setInterval(poll, 2200);
    return () => { active = false; window.clearInterval(id); };
  }, [sessionKey, token]);

  const runAction = async (action: SessionActionInput) => {
    if (!sessionKey || !token) return;
    setLoading(true);
    try { rememberSession(await applyMatchAction(sessionKey, action, requestWithToken(token))); }
    catch { showNotice('操作を同期できませんでした。もう一度試してください'); }
    finally { setLoading(false); }
  };
  const create = async () => {
    if (!setup.name.trim()) { showNotice('プレイヤー名を入力してください'); return; }
    setLoading(true);
    const input: SessionCreateInput = { playerName: setup.name.trim(), button: setup.button, centerDifficulty: setup.center, lowerOffset: setup.lower, upperOffset: setup.upper, p1Owned: setup.p1Owned, p2Owned: setup.p2Owned, selectedPacks: setup.selectedPacks };
    try { rememberSession(await createMatchSession(input)); showNotice('セッションを作成しました。キーを相手に渡してください'); }
    catch { showNotice('セッションを作成できませんでした'); }
    finally { setLoading(false); }
  };
  const join = async () => {
    if (!joinKey.trim() || !joinName.trim()) { showNotice('セッションキーとプレイヤー名を入力してください'); return; }
    setLoading(true);
    try {
      const next = await joinMatchSession(joinKey.trim().toUpperCase(), { playerName: joinName.trim() });
      rememberSession(next);
      setSetup((value) => ({
        ...value,
        name: joinName.trim(),
        button: next.button as ButtonMode,
        center: next.centerDifficulty,
        lower: next.lowerOffset,
        upper: next.upperOffset,
        p1Owned: next.p1Owned,
        p2Owned: next.p2Owned,
        selectedPacks: next.selectedPacks,
      }));
      showNotice('セッションに参加しました');
    }
    catch { showNotice('キーが見つからないか、満員です'); }
    finally { setLoading(false); }
  };
  const leave = () => { setSession(null); setSessionKey(''); setToken(''); localStorage.removeItem(SESSION_KEY); localStorage.removeItem(TOKEN_KEY); };
  const copyKey = async () => { await navigator.clipboard?.writeText(sessionKey); setCopied(true); window.setTimeout(() => setCopied(false), 1400); };
  const currentRound = session?.rounds[session.currentRound];
  const currentSongs = useMemo(() => {
    if (!session || !currentRound) return [];
    return catalog.filter((song) => song.unofficialDifficulty >= currentRound.lower && song.unofficialDifficulty <= currentRound.upper && (!currentRound.tag || song.chartTags.includes(currentRound.tag)) && (session.selectedPacks.length === 0 || session.selectedPacks.includes(song.pack) || song.pack === 'V-ARCHIVE'));
  }, [catalog, currentRound, session]);

  if (!session) return <Lobby setup={setup} setSetup={setSetup} joinKey={joinKey} setJoinKey={setJoinKey} joinName={joinName} setJoinName={setJoinName} loading={loading} notice={notice} onCreate={create} onJoin={join} onLoadCatalog={() => void loadCatalog(setup.button)} catalogCount={catalog.length} catalogSource={catalogSource} />;
  if (session.status === 'waiting' || session.status === 'setup') return <WaitingRoom session={session} setup={setup} setSetup={setSetup} loading={loading} notice={notice} onAction={runAction} onStart={() => void runAction({ action: 'start-match' })} onLeave={leave} onCopy={copyKey} copied={copied} />;
  return <MatchBoard session={session} songs={currentSongs} catalogSource={catalogSource} loading={loading} notice={notice} genreFlash={genreFlash} onAction={runAction} onGenre={() => { setGenreFlash(true); window.setTimeout(() => setGenreFlash(false), 420); void runAction({ action: 'draw-chart-tag' }); }} onLeave={leave} onCopy={copyKey} copied={copied} />;
}

function Frame({ children, status, notice, onLeave }: { children: React.ReactNode; status: string; notice: string; onLeave?: () => void }) {
  return <main className="online-frame"><header className="online-topbar"><div className="online-brand"><span className="brand-bars"><i /><i /><i /></span><div><strong>DJMAX / BPL 管制室</strong><small>ONLINE MATCH CONTROL</small></div></div><div className="online-status"><span />{status}{onLeave && <button onClick={onLeave}><RotateCcw size={14} /> ロビーへ戻る</button>}</div></header>{notice && <div className="toast-note">{notice}</div>}{children}</main>;
}

function Lobby({ setup, setSetup, joinKey, setJoinKey, joinName, setJoinName, loading, notice, onCreate, onJoin, onLoadCatalog, catalogCount, catalogSource }: { setup: LocalSetup; setSetup: React.Dispatch<React.SetStateAction<LocalSetup>>; joinKey: string; setJoinKey: (value: string) => void; joinName: string; setJoinName: (value: string) => void; loading: boolean; notice: string; onCreate: () => void; onJoin: () => void; onLoadCatalog: () => void; catalogCount: number; catalogSource: string | null }) {
  const toggle = (field: 'p1Owned' | 'p2Owned' | 'selectedPacks', id: string) => setSetup((value) => ({ ...value, [field]: value[field].includes(id) ? value[field].filter((item) => item !== id) : [...value[field], id] }));
  return <Frame status="READY / ONLINE" notice={notice}><div className="lobby-layout"><section className="lobby-hero"><div className="eyebrow"><Swords size={14} /> ONLINE SESSION / 002</div><h1>キーを渡して、<em>同じ盤面</em>で戦う。</h1><p>セッションキーで相手を招待。設定・抽選・ストラテジーを、2つの画面でリアルタイム同期します。</p><div className="hero-rule"><span>V-ARCHIVE</span><span>CHART-BASED TAGS</span><span>SYNCED</span></div></section><section className="lobby-panel"><div className="lobby-tabs"><span className="active"><UserPlus size={16} /> 新しいセッション</span><span><LogIn size={16} /> 参加する</span></div><div className="lobby-forms"><div className="form-block"><label>あなたのプレイヤー名</label><input value={setup.name} onChange={(event) => setSetup((value) => ({ ...value, name: event.target.value }))} placeholder="PLAYER 01" maxLength={18} /><div className="form-help">セッション作成後にキーが発行されます</div></div><button className="primary-action" onClick={onCreate} disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />} セッションを作成</button><div className="divider"><span>または</span></div><div className="form-block"><label>相手から受け取ったセッションキー</label><div className="key-input"><input value={joinKey} onChange={(event) => setJoinKey(event.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} /><span>6桁</span></div><input value={joinName} onChange={(event) => setJoinName(event.target.value)} placeholder="あなたのプレイヤー名" maxLength={18} /></div><button className="secondary-action" onClick={onJoin} disabled={loading}><LogIn size={17} /> キーで参加する</button></div><div className="catalog-setup"><div className="catalog-head"><div><span className="eyebrow">DATA SOURCE</span><strong>非公式難易度</strong></div><button onClick={onLoadCatalog}><RefreshCw size={14} /> 4Bを再取得</button></div><p>V-ARCHIVE MAX DJ POWERの値を中心難易度と選曲帯に使用します。現在 {catalogCount} 譜面 / {catalogSource === 'v-archive' ? 'V-ARCHIVE接続中' : catalogSource === 'fallback' ? '内蔵フォールバック' : '未取得'}。</p><a href="https://v-archive.net/djpower/4" target="_blank" rel="noreferrer">V-ARCHIVE 4Bを開く <ExternalLink size={13} /></a></div></section></div><SetupControls setup={setup} setSetup={setSetup} toggle={toggle} /></Frame>;
}

function SetupControls({ setup, setSetup, toggle }: { setup: LocalSetup; setSetup: React.Dispatch<React.SetStateAction<LocalSetup>>; toggle: (field: 'p1Owned' | 'p2Owned' | 'selectedPacks', id: string) => void }) {
  return <section className="setup-controls"><div className="control-heading"><div><span className="eyebrow">MATCH PARAMETERS</span><h2>対戦盤面を先に固定する</h2></div><span className="control-note">参加後も2人で変更できます</span></div><div className="control-grid"><div className="control-card"><div className="card-title"><span>ボタンモード</span><small>V-ARCHIVE対象</small></div><div className="mode-row">{([4, 5, 6, 8] as ButtonMode[]).map((button) => <button key={button} className={setup.button === button ? 'selected' : ''} onClick={() => setSetup((value) => ({ ...value, button }))}>{button}B</button>)}</div></div><div className="control-card"><div className="card-title"><span>中心難易度</span><small>V-ARCHIVE MAX DJ POWER</small></div><div className="number-line"><input type="number" min={1} max={20} step={0.1} value={setup.center} onChange={(event) => setSetup((value) => ({ ...value, center: Number(event.target.value) }))} /><b>SC</b></div><div className="offsets"><label>下方向 <input type="number" min={0} max={5} step={0.1} value={setup.lower} onChange={(event) => setSetup((value) => ({ ...value, lower: Number(event.target.value) }))} /></label><label>上方向 <input type="number" min={0} max={5} step={0.1} value={setup.upper} onChange={(event) => setSetup((value) => ({ ...value, upper: Number(event.target.value) }))} /></label></div><p>LOWは中心より下、MIDは中心付近、HIGHは中心より上</p></div><div className="control-card ownership-card"><div className="card-title"><span>所持DLC / 共有プール</span><small>両者がチェックしたものだけ使用</small></div><div className="ownership-lines">{PACKS.map((pack) => <div className="ownership-line" key={pack.id}><div><i className={`pack-dot ${pack.accent}`} /><strong>{pack.label}</strong><small>{pack.sub}</small></div><button className={setup.p1Owned.includes(pack.id) ? 'owned p1' : ''} onClick={() => toggle('p1Owned', pack.id)}>P1 {setup.p1Owned.includes(pack.id) ? '所持' : '未所持'}</button><button className={setup.p2Owned.includes(pack.id) ? 'owned p2' : ''} onClick={() => toggle('p2Owned', pack.id)}>P2 {setup.p2Owned.includes(pack.id) ? '所持' : '未所持'}</button><button className={setup.selectedPacks.includes(pack.id) ? 'pool' : ''} disabled={!setup.p1Owned.includes(pack.id) || !setup.p2Owned.includes(pack.id)} onClick={() => toggle('selectedPacks', pack.id)}>{setup.selectedPacks.includes(pack.id) ? <Check size={14} /> : <span>+</span>} 共有</button></div>)}</div></div></div><p className="data-note"><Gauge size={14} /> 公式難易度ではなく、V-ARCHIVEの非公式値を採用。譜面傾向タグは「曲のジャンル」ではなく、物量・ハネリズム・階段などの譜面内容を示します。</p></section>;
}

function WaitingRoom({ session, setup, setSetup, loading, notice, onAction, onStart, onLeave, onCopy, copied }: { session: SessionState; setup: LocalSetup; setSetup: React.Dispatch<React.SetStateAction<LocalSetup>>; loading: boolean; notice: string; onAction: (action: SessionActionInput) => Promise<void>; onStart: () => void; onLeave: () => void; onCopy: () => void; copied: boolean }) {
  const toggle = (field: 'p1Owned' | 'p2Owned' | 'selectedPacks', id: string) => setSetup((value) => ({ ...value, [field]: value[field].includes(id) ? value[field].filter((item) => item !== id) : [...value[field], id] }));
  const syncSetup = () => void onAction({ action: 'set-setup', button: setup.button, centerDifficulty: setup.center, lowerOffset: setup.lower, upperOffset: setup.upper, p1Owned: setup.p1Owned, p2Owned: setup.p2Owned, selectedPacks: setup.selectedPacks });
  return <Frame status={session.status === 'waiting' ? 'WAITING FOR OPPONENT' : 'BOTH PLAYERS READY'} notice={notice} onLeave={onLeave}><div className="room-shell"><section className="room-key-card"><div className="eyebrow"><LockKeyhole size={14} /> PRIVATE SESSION KEY</div><h1>{session.key}</h1><p>このキーを相手に共有してください。相手は「キーで参加する」から参加できます。</p><button className="copy-key" onClick={onCopy}>{copied ? <><Check size={17} /> コピーしました</> : <><Copy size={17} /> セッションキーをコピー</>}</button><div className="room-players"><div className="room-player p1"><span>PLAYER 01 / HOST</span><strong>{session.p1}</strong><i>接続中</i></div><div className="room-vs">VS</div><div className="room-player p2"><span>PLAYER 02 / GUEST</span><strong>{session.p2 ?? '参加待ち…'}</strong><i className={session.p2 ? 'connected' : ''}>{session.p2 ? '接続中' : 'キーを共有'}</i></div></div></section><section className="room-settings"><div className="room-setting-head"><div><span className="eyebrow">SHARED SETUP</span><h2>共有設定</h2></div><button className="ghost-action" onClick={syncSetup} disabled={loading}><RefreshCw size={15} /> 同期する</button></div><div className="center-readout"><span>中心難易度</span><strong>{session.centerDifficulty.toFixed(1)}</strong><small>SC / V-ARCHIVE</small></div><div className="room-ranges">{session.rounds.map((round, index) => <div className={index === 1 ? 'active' : ''} key={round.label}><span>0{index + 1}</span><strong>{round.label}</strong><small>{round.lower.toFixed(1)} — {round.upper.toFixed(1)}</small></div>)}</div><div className="room-dlc-row"><span>共有プール</span>{session.selectedPacks.map((pack) => <b key={pack}>{pack}</b>)}</div>{session.status === 'waiting' ? <div className="waiting-message"><LoaderCircle className="spin" size={17} /> 相手の参加を待っています</div> : <button className="primary-action wide" onClick={onStart} disabled={loading}><Swords size={17} /> この設定で対戦を開始 <ChevronRight size={17} /></button>}<p className="room-footnote">設定を変更したら「同期する」を押してください。相手の画面にも反映されます。</p></section></div><SetupControls setup={setup} setSetup={setSetup} toggle={toggle} /></Frame>;
}

function MatchBoard({ session, songs, catalogSource, loading, notice, genreFlash, onAction, onGenre, onLeave, onCopy, copied }: { session: SessionState; songs: CatalogSong[]; catalogSource: string | null; loading: boolean; notice: string; genreFlash: boolean; onAction: (action: SessionActionInput) => Promise<void>; onGenre: () => void; onLeave: () => void; onCopy: () => void; copied: boolean }) {
  const round = session.rounds[session.currentRound];
  const bothCards = round.p1Card && round.p2Card;
  return <Frame status={session.status === 'finished' ? 'MATCH FINISHED' : 'LIVE / SYNCED'} notice={notice} onLeave={onLeave}><div className="match-toolbar"><div><span className="eyebrow"><span className="live-pip" /> SESSION {session.key}</span><h1>{session.p1} <em>対</em> {session.p2}</h1></div><button className="copy-session" onClick={onCopy}>{copied ? <Check size={14} /> : <Copy size={14} />} キーをコピー</button></div><div className="round-progress">{session.rounds.map((item, index) => <div className={`${index === session.currentRound ? 'active' : ''} ${index < session.currentRound ? 'done' : ''}`} key={item.label}><span>0{index + 1}</span><strong>{item.label}</strong><small>{item.lower.toFixed(1)} — {item.upper.toFixed(1)}</small></div>)}</div><div className="match-grid"><section><div className={`tag-draw ${genreFlash ? 'flash' : ''}`}><div><span className="eyebrow">ROUND 0{session.currentRound + 1} / CHART GENRE</span><h2>{round.tag ?? '譜面傾向を抽選'}</h2><p>{round.tag ? 'この譜面傾向を持つ曲から選曲' : '曲のジャンルではなく、譜面内容を抽選します'}</p></div><button onClick={onGenre} disabled={loading}><Dices size={19} /> 譜面傾向を引く</button></div><div className="pool-header"><div><span className="eyebrow">V-ARCHIVE / {session.button}B</span><h2>選曲候補</h2></div><span>{songs.length} 譜面</span></div><div className="catalog-source">{catalogSource === 'v-archive' ? <><span className="source-live" /> V-ARCHIVEから取得した非公式難易度</> : '内蔵カタログ（V-ARCHIVE接続失敗時）'}</div><div className="song-table">{songs.length ? songs.map((song, index) => <div className={`song-entry ${round.pickedSongId === song.id ? 'picked' : ''}`} key={song.id}><span className="song-index">{String(index + 1).padStart(2, '0')}</span><div className="song-main"><strong>{song.title}</strong><small>{song.artist} / {song.chart}</small></div><div className="tag-list">{song.chartTags.map((tag) => <span key={tag}>{tag}</span>)}</div><b className="unofficial-level">{song.unofficialDifficulty.toFixed(1)}</b><button onClick={() => void onAction({ action: 'pick-song', songId: song.id })}>{round.pickedSongId === song.id ? <Check size={15} /> : '選曲'}</button></div>) : <div className="empty-catalog"><Gauge size={23} /><strong>この帯域の候補がありません</strong><span>中心難易度または上下幅を調整してください</span></div>}</div></section><aside><div className="side-panel strategy-panel"><div className="panel-head"><div><span className="eyebrow">TACTICAL CARD</span><h2>ストラテジー</h2></div><Shield size={20} /></div><p>相手も同じラウンドで使うと、お互いのカードが相殺されます。</p><StrategyRow name={session.p1} active={round.p1Card} isMine={session.role === 'host'} disabled={loading || round.resolved} onUse={() => void onAction({ action: 'use-strategy' })} /><div className="strategy-divider">VS</div><StrategyRow name={session.p2 ?? '相手待ち'} active={round.p2Card} isMine={session.role === 'guest'} disabled={loading || round.resolved} onUse={() => void onAction({ action: 'use-strategy' })} /><div className={`strategy-status ${bothCards ? 'cancelled' : round.pickedSongId ? 'used' : ''}`}>{bothCards ? <><Check size={15} /> 両者使用 / 相殺成立</> : round.pickedSongId ? <><Zap size={15} /> ストラテジーで自動選曲</> : <><LockKeyhole size={14} /> 使用タイミングを選択</>}</div>{bothCards && !round.resolved && <button className="resolve-card" onClick={() => void onAction({ action: 'resolve-strategy' })}>相殺を確定する <Check size={15} /></button>}{round.pickedSongTitle && <div className="strategy-pick"><small>ストラテジー選曲</small><strong>{round.pickedSongTitle}</strong></div>}</div><div className="side-panel protocol-panel"><div className="panel-head"><div><span className="eyebrow">MATCH PROTOCOL</span><h2>進行状況</h2></div><Trophy size={19} /></div><div className="protocol-row"><span>中心</span><strong>{session.centerDifficulty.toFixed(1)} SC</strong></div><div className="protocol-row"><span>現在</span><strong>{round.lower.toFixed(1)} — {round.upper.toFixed(1)}</strong></div><div className="protocol-row"><span>傾向</span><strong>{round.tag ?? '未抽選'}</strong></div></div><button className="next-round" onClick={() => void onAction({ action: 'advance-round' })} disabled={loading}>{session.currentRound === 2 ? <><Trophy size={18} /> セットを完了</> : <>次のラウンドへ <ChevronRight size={18} /></>}</button></aside></div></Frame>;
}

function StrategyRow({ name, active, isMine, disabled, onUse }: { name: string; active: boolean; isMine: boolean; disabled: boolean; onUse: () => void }) {
  return <div className={`strategy-row ${active ? 'active' : ''}`}><span className="initial">{name.slice(0, 1)}</span><div><strong>{name}</strong><small>{isMine ? 'あなたのカード' : '相手のカード'}</small></div><button onClick={onUse} disabled={disabled || !isMine}>{active ? <><Check size={14} /> 使用中</> : isMine ? <><Zap size={14} /> 使用する</> : '待機中'}</button></div>;
}

export default App;