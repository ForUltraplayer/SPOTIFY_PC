/** @file ivlyrics-sync-ui.js
 * @author: ForUltraplayer
 * @brief Add a direction-first lyric alignment editor to the existing ivLyrics sync controls.
 */
(() => {
    'use strict';
    function create(react, host = window) {
        const h = react.createElement;
        const { useEffect, useRef, useState } = react;
        const styles = {
            shade: { position: 'fixed', inset: 0, zIndex: 11000, background: 'rgba(0,0,0,.68)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, color: '#fff', textAlign: 'left', cursor: 'default' },
            panel: { width: 'min(720px, 100%)', maxHeight: '85vh', overflowY: 'auto', background: '#202020', border: '1px solid #555', borderRadius: 12, padding: 24, display: 'grid', gap: 18, boxShadow: '0 16px 60px #0008', fontSize: 14, lineHeight: 1.5 },
            row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
            button: { border: '1px solid #777', borderRadius: 6, background: '#333', color: '#fff', padding: '8px 12px', cursor: 'pointer', font: 'inherit' },
            input: { background: '#151515', color: '#fff', border: '1px solid #777', borderRadius: 6, padding: 8, font: 'inherit' },
            section: { display: 'grid', gap: 10, borderTop: '1px solid #555', paddingTop: 16 },
            muted: { color: '#c9c9c9', margin: 0 },
        };
        function Editor({ controller, owner, currentUri, onClose, restoreFocus }) {
            const api = host.SpotifyHangulSync;
            const [offset, setOffset] = useState(0), [amount, setAmount] = useState('0'), [direction, setDirection] = useState('advance');
            const [loaded, setLoaded] = useState(false), [pending, setPending] = useState(false), [previous, setPrevious] = useState(null);
            const [selected, setSelected] = useState(''), [lines, setLines] = useState([]), [message, setMessage] = useState('보정값을 불러오는 중입니다.'), [error, setError] = useState('');
            const alive = useRef(true), busy = useRef(false), offsetRef = useRef(0), panelRef = useRef(null);
            const stale = currentUri !== owner.uri || !controller.isCurrent(owner.uri);
            const disabled = !loaded || pending || stale;
            const showOffset = value => {
                offsetRef.current = value; setOffset(value);
                setAmount(String(Number((Math.abs(value) / 1000).toFixed(3))));
                setDirection(value < 0 ? 'delay' : 'advance');
            };
            useEffect(() => {
                alive.current = true;
                let cancelled = false;
                setLines(controller.getLines());
                Promise.resolve(controller.getOffset(owner.uri)).then(value => {
                    if (cancelled || !controller.isCurrent(owner.uri)) return;
                    showOffset(value); setLoaded(true); setMessage('이 곡에 저장된 보정값입니다.');
                }).catch(failure => { if (!cancelled) setError(failure.message || '저장된 보정값을 불러오지 못했습니다.'); });
                const changed = event => {
                    if (event.detail?.trackUri !== owner.uri || busy.current || !controller.isCurrent(owner.uri)) return;
                    showOffset(event.detail.offset); setPrevious(null); setMessage('다른 싱크 조절에서 바꾼 값을 반영했습니다.');
                };
                const previousFocus = restoreFocus;
                const escape = event => {
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
                    if (event.key === 'Tab' && panelRef.current) {
                        const controls = [...panelRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
                        const first = controls[0], last = controls[controls.length - 1], focused = host.document?.activeElement;
                        if (event.shiftKey && (focused === first || !panelRef.current.contains(focused))) { event.preventDefault(); last?.focus(); }
                        else if (!event.shiftKey && (focused === last || !panelRef.current.contains(focused))) { event.preventDefault(); first?.focus(); }
                    }
                };
                host.addEventListener?.('ivLyrics:offset-changed', changed);
                host.addEventListener?.('keydown', escape);
                return () => { cancelled = true; alive.current = false; host.removeEventListener?.('ivLyrics:offset-changed', changed); host.removeEventListener?.('keydown', escape); if (previousFocus?.isConnected !== false) previousFocus?.focus?.(); };
            }, [controller, owner.uri]);
            const apply = async (value, undo = false) => {
                if (busy.current || !loaded || !controller.isCurrent(owner.uri) || currentUri !== owner.uri) return;
                let next;
                try { next = api.normalizeOffset(value); } catch (failure) { setError(failure.message); return; }
                const before = offsetRef.current;
                busy.current = true; setPending(true); setError('');
                try {
                    const saved = await controller.setOffset(owner.uri, next);
                    if (!alive.current || !controller.isCurrent(owner.uri)) return;
                    showOffset(saved); setPrevious(undo ? null : before);
                    setMessage(undo ? '직전 보정을 취소하고 저장했습니다.' : '이 곡에 저장했습니다. 다음 재생에도 적용됩니다.');
                } catch (failure) { if (alive.current) setError(failure.message || '보정값을 저장하지 못했습니다.'); }
                finally { busy.current = false; if (alive.current) setPending(false); }
            };
            const align = () => {
                try {
                    // Capture the audible instant before any asynchronous database work.
                    const position = controller.getPosition(), global = controller.getGlobalOffset();
                    const line = lines.find(value => String(value.index) === selected);
                    const current = controller.getLines().find(value => value.index === line?.index && value.startTime === line?.startTime && value.text === line?.text);
                    if (!line || !current) { setError('가사가 바뀌었습니다. 문장 목록을 새로 불러와 선택해 주세요.'); return; }
                    void apply(api.alignOffset(line.startTime, position, global));
                }
                catch (failure) { setError(failure.message); }
            };
            const selectedLine = lines.find(value => String(value.index) === selected);
            const button = (label, onClick, extra = {}) => h('button', { type: 'button', style: styles.button, disabled, onClick, ...extra }, label);
            const sectionTitle = text => h('h3', { style: { fontSize: 16, fontWeight: 700, margin: 0 } }, text);
            const dialog = h('div', { className: 'hangul-sync-shade ivlyrics-fluent-overlay is-open', style: styles.shade, onClick: event => { if (event.target === event.currentTarget) onClose(); }, onMouseDown: event => event.stopPropagation() },
                h('section', { ref: panelRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': '쉽게 싱크 맞추기', style: styles.panel },
                    h('div', { style: { ...styles.row, justifyContent: 'space-between' } }, h('h2', { style: { margin: 0, fontSize: 21 } }, '쉽게 싱크 맞추기'), h('button', { type: 'button', autoFocus: true, style: styles.button, onClick: onClose, 'aria-label': '싱크 맞추기 닫기' }, '닫기')),
                    h('p', { style: styles.muted }, owner.title),
                    stale ? h('p', { role: 'alert', style: { color: '#ffcc80', margin: 0 } }, '재생 곡이 바뀌었습니다. 창을 닫고 현재 곡에서 다시 열어 주세요.') : null,
                    h('output', { 'aria-live': 'polite', style: { fontWeight: 700, fontSize: 17 } }, loaded ? api.formatOffset(offset) : '불러오는 중…'),
                    h('section', { style: styles.section }, sectionTitle('1. 지금 부르는 문장으로 맞추기'),
                        h('p', { style: styles.muted }, '문장을 고른 뒤, 노래에서 그 문장을 부르기 시작할 때 아래 버튼을 누르세요. 노래는 그대로 재생되고 가사 전체만 이동합니다.'),
                        h('label', null, '맞출 가사 문장', h('select', { 'aria-label': '맞출 가사 문장', disabled: disabled || lines.length === 0, value: selected, size: 6, onChange: event => setSelected(event.target.value), style: { ...styles.input, display: 'block', width: '100%', marginTop: 6 } },
                            h('option', { value: '' }, lines.length ? '문장을 선택하세요' : '시간 정보가 있는 가사가 없습니다'),
                            lines.map(line => h('option', { key: line.index, value: String(line.index) }, line.text)))),
                        selectedLine ? h('p', { style: styles.muted }, selectedLine.text) : null,
                        h('div', { style: styles.row }, button('지금 이 문장 시작', align, { disabled: disabled || !selectedLine, style: { ...styles.button, background: '#1d6f42', borderColor: '#4fc77b', fontWeight: 700 } }),
                            button('문장 목록 새로 불러오기', () => { setLines(controller.getLines()); setSelected(''); setError(''); }))),
                    h('section', { style: styles.section }, sectionTitle('2. 초 단위로 미세 조절'),
                        h('div', { style: styles.row },
                            button('가사를 1 초 먼저', () => void apply(offsetRef.current + 1000)), button('가사를 0.1 초 먼저', () => void apply(offsetRef.current + 100)),
                            button('가사를 0.1 초 나중에', () => void apply(offsetRef.current - 100)), button('가사를 1 초 나중에', () => void apply(offsetRef.current - 1000))),
                        h('div', { style: styles.row }, h('label', null, '직접 입력 ', h('input', { type: 'number', 'aria-label': '보정할 초', min: 0, max: 60, step: 0.1, value: amount, disabled, onChange: event => setAmount(event.target.value), style: { ...styles.input, width: 90 } })), '초',
                            h('select', { 'aria-label': '가사 표시 방향', value: direction, disabled, onChange: event => setDirection(event.target.value), style: styles.input }, h('option', { value: 'advance' }, '먼저 표시'), h('option', { value: 'delay' }, '나중에 표시')),
                            button('입력한 시간 적용', () => { const seconds = amount.trim() === '' ? NaN : Number(amount); if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) { setError('0~60 초 사이의 시간을 입력해 주세요.'); return; } void apply(seconds * 1000 * (direction === 'delay' ? -1 : 1)); })),
                        h('p', { style: styles.muted }, '가사가 늦게 나오면 ‘먼저’, 너무 일찍 나오면 ‘나중에’를 누르세요. 최대 60 초까지 조절할 수 있습니다.')),
                    h('section', { style: styles.section }, sectionTitle('3. 이 곡에 저장 및 되돌리기'),
                        h('p', { style: styles.muted }, owner.uri.startsWith('youtube:') ? '보정값은 이 YouTube 영상에만 저장됩니다. 원곡이나 다른 커버는 바뀌지 않습니다.' : '보정값은 이 Spotify 곡에만 저장됩니다. 다른 곡의 보정은 바뀌지 않습니다.'),
                        h('div', { style: styles.row }, button('직전 보정 취소', () => void apply(previous, true), { disabled: disabled || previous === null }), button('원래대로', () => void apply(0))),
                        h('p', { role: 'status', style: styles.muted }, pending ? '저장 중…' : message)),
                    error ? h('p', { role: 'alert', style: { color: '#ffcc80', margin: 0 } }, error) : null));
            const portal = host.Spicetify?.ReactDOM?.createPortal;
            return typeof portal === 'function' && host.document?.body ? portal(dialog, host.document.body) : dialog;
        }
        return function HangulTrackSyncEditor({ trackUri }) {
            const controllerRef = useRef(null);
            if (!controllerRef.current) controllerRef.current = host.SpotifyHangulSyncController || host.SpotifyHangulSync.create(host);
            const controller = controllerRef.current;
            const [owner, setOwner] = useState(null), [error, setError] = useState('');
            const previousFocus = useRef(null);
            return h(react.Fragment, null,
                h('button', { type: 'button', className: 'lyrics-track-sync-easy', style: { ...styles.button, fontSize: 12, padding: '6px 10px' }, disabled: !trackUri, onClick: () => {
                    const track = controller.captureTrack();
                    if (!track || track.uri !== trackUri) { setError('현재 곡의 가사 화면에서 다시 열어 주세요.'); return; }
                    previousFocus.current = host.document?.activeElement;
                    setError(''); setOwner(track);
                } }, '쉽게 싱크 맞추기'),
                error ? h('span', { role: 'alert' }, error) : null,
                owner ? h(Editor, { controller, owner, currentUri: trackUri, restoreFocus: previousFocus.current, onClose: () => setOwner(null) }) : null);
        };
    }
    const api = { create };
    if (typeof module !== 'undefined') module.exports = api;
    if (typeof window !== 'undefined') window.SpotifyHangulSyncUI = api;
})();
