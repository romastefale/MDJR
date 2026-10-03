import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { inventHit } from "../hits.js";
import { apiOrigin, apiRequest, onPages } from "./api.js";
import { APP_VERSION, DURATIONS, ROW_COUNT, SAMPLE_RATE } from "./config.js";
import { createDcBlock, createLowpass } from "./dsp.js";
import { compileRow, DEFAULT_PATCH, sampleRow, toDisplay } from "./formula.js";
import { Glass, GLASS_BAR } from "./glass.jsx";
import { Icon, ICONS, ThemeIcon } from "./icons.jsx";
import { encodeMp3 } from "./mp3.js";
import { drawPlane } from "./plane.js";
import { clampBpm, clampVolume, DEFAULT_ROWS, normalizeRows, rowFromDraft, withRowColors } from "./rows.js";
import { telegramApp } from "./telegram.js";
import { formatTime, overflowsThreeLines } from "./text.js";
import { applyTheme } from "./theme.js";

const THEME_KEY = "mdjr-theme";
const DRAFT_ID = /^[a-f0-9]{8}$/;
const MORE_OPEN = '.sh-pill.more[aria-expanded="true"]';

export function App() {
  const [rows, setRows] = useState(() => normalizeRows(DEFAULT_ROWS));
  const [seconds, setSeconds] = useState(60);
  const [patch, setPatch] = useState({ ...DEFAULT_PATCH, mode: "custom" });
  // Header menu: null (closed), "root", "tempo" or "drafts".
  const [menu, setMenu] = useState(null);
  // Row menu (the ⋮ of a row): id of the row whose menu is open, and its page ("root", "bpm", "vol").
  const [rowMenuId, setRowMenuId] = useState(null);
  const [rowMenuPage, setRowMenuPage] = useState("root");
  const [rowMenuBox, setRowMenuBox] = useState({ max: 240, right: 8, top: null, bottom: null });
  const [playing, setPlaying] = useState(false);
  // Short status shown on the plane: "sent" or "failed" (song to the chat), "sem áudio" or a draft name.
  const [mark, setMark] = useState("");
  const [dark, setDark] = useState(true);
  // True while a formula is being typed (keyboard open): the plane hides.
  const [editing, setEditing] = useState(false);
  const [clock, setClock] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [drafts, setDrafts] = useState([]);
  // Per row: the formula needs more than three lines (the row is then muted and marked "3 LINHAS").
  const [overflow, setOverflow] = useState([false, false, false, false, false]);

  const rowsRef = useRef(rows);
  const patchRef = useRef(patch);
  const secondsRef = useRef(seconds);
  const playheadRef = useRef(0);
  const playingRef = useRef(false);
  const audioRef = useRef(null); // { ctx, node, origin, started }
  const canvasRef = useRef(null);
  const scaleRef = useRef(1.15);
  const sentScaleRef = useRef(1.15);
  const overflowRef = useRef(overflow);
  const headerRef = useRef(null);
  const focusedRef = useRef(null); // last focused formula textarea
  const keepFocusRef = useRef(false); // a button was touched while typing
  const focusedAtRef = useRef(0);
  const editingRef = useRef(false);
  const rowMenuRef = useRef(null);
  const draftIdRef = useRef("");
  const autosaveRef = useRef(0);

  const compiled = useMemo(() => rows.map((row) => compileRow(row.y)), [rows]);
  const compiledRef = useRef(compiled);

  rowsRef.current = rows;
  patchRef.current = patch;
  secondsRef.current = seconds;
  compiledRef.current = compiled;
  overflowRef.current = overflow;

  useLayoutEffect(() => {
    const areas = document.querySelectorAll(".fn-row textarea");
    const next = rows.map((row, i) => {
      const width = areas[i]?.clientWidth || 0;
      return width < 40 ? false : overflowsThreeLines(row.y, width);
    });
    setOverflow((prev) => (prev.length === next.length && prev.every((value, i) => value === next[i]) ? prev : next));
  }, [rows]);

  useEffect(() => {
    audioRef.current?.node.port.postMessage(workletMessage());
  }, [rows, patch, compiled, overflow]);

  rowMenuRef.current = rowMenuId;
  editingRef.current = editing;

  // Opens the row menu below or above its ⋮ button, whichever side has more room in the visual viewport.
  function placeRowMenu(button) {
    const box = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const offsetTop = viewport?.offsetTop ?? 0;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const minY = offsetTop + 8;
    const maxY = offsetTop + (viewport?.height ?? window.innerHeight) - 8;
    const above = box.bottom - minY;
    const below = maxY - box.top;
    const up = above >= below;
    const max = Math.max(44, Math.floor(up ? above : below));
    const right = Math.max(8, window.innerWidth - (box.right + offsetLeft));
    const top = up ? null : box.top + offsetTop;
    const bottom = up ? Math.max(8, window.innerHeight - (box.bottom + offsetTop)) : null;
    setRowMenuBox((prev) =>
      prev.max === max && prev.right === right && prev.top === top && prev.bottom === bottom ? prev : { max, right, top, bottom },
    );
  }

  function draftName(list) {
    return list[0]?.y.replace(/\s+/g, " ").trim().slice(0, 32) || "Untitled";
  }

  // Autosave to the progress slot, 180 ms after the last change.
  function scheduleAutosave(list, length, sound) {
    window.clearTimeout(autosaveRef.current);
    autosaveRef.current = window.setTimeout(() => {
      apiRequest("POST", "/drafts/progress", { name: draftName(list), rows: list, seconds: length, patch: sound });
    }, 180);
  }

  function commitRows(list) {
    const next = withRowColors(list);
    rowsRef.current = next;
    setRows(next);
    scheduleAutosave(next, secondsRef.current, patchRef.current);
  }

  function generateRow(index) {
    const formula = inventHit(index);
    const list = rowsRef.current.slice();
    const row = list[index];
    if (!row) return;
    list[index] = { ...row, y: toDisplay(formula), on: true };
    commitRows(list);
  }

  // Average of the audible rows at `time`, each scaled by its volume (same mix as web/worklet.js).
  function mixSample(time, list, voices, sound) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      if (!list[i]?.on || !voices[i]?.ok || overflowRef.current[i]) continue;
      sum += sampleRow(voices[i], sound, time, list[i].bpm) * list[i].vol;
      count += 1;
    }
    return count ? sum / count : 0;
  }

  // Keeps --vvh/--vvt/--overlay in sync with the visual viewport and Telegram safe areas, and
  // detects the on-screen keyboard (editing mode).
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const webApp = telegramApp();
      const tgHeight = webApp?.viewportHeight || 0;
      const usable = tgHeight > 0 ? Math.min(height, tgHeight) : height;
      const safeTop = Math.max(offsetTop, webApp?.contentSafeAreaInset?.top || 0, webApp?.safeAreaInset?.top || 0);
      const safeBottom = Math.max(webApp?.contentSafeAreaInset?.bottom || 0, webApp?.safeAreaInset?.bottom || 0);
      const keyboard = Math.max(0, window.innerHeight - height - offsetTop);
      const root = document.documentElement;
      root.style.setProperty("--vvh", `${usable}px`);
      root.style.setProperty("--vvt", `${safeTop}px`);
      root.style.setProperty("--overlay", `${Math.round(safeBottom * 0.9)}px`);
      const keyboardOpen = keyboard > 80;
      const typing = document.activeElement instanceof HTMLTextAreaElement && (keyboardOpen || Date.now() - focusedAtRef.current < 700);
      if (typing !== editingRef.current) {
        editingRef.current = typing;
        setEditing(typing);
      }
      if (rowMenuRef.current !== null) {
        const button = document.querySelector(MORE_OPEN);
        if (button instanceof HTMLButtonElement) placeRowMenu(button);
      }
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const webApp = telegramApp();
    webApp?.onEvent?.("viewportChanged", update);
    webApp?.onEvent?.("safeAreaChanged", update);
    webApp?.onEvent?.("contentSafeAreaChanged", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      webApp?.offEvent?.("viewportChanged", update);
      webApp?.offEvent?.("safeAreaChanged", update);
      webApp?.offEvent?.("contentSafeAreaChanged", update);
    };
  }, []);

  // Touching a button while typing must not close the keyboard: swallow the touch, click the
  // button by hand and give the focus back to the textarea.
  useEffect(() => {
    const onTouchStart = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button") && document.activeElement instanceof HTMLTextAreaElement) {
        focusedRef.current = document.activeElement;
        keepFocusRef.current = true;
        event.preventDefault();
      }
    };
    const onTouchEnd = (event) => {
      if (!keepFocusRef.current) return;
      const button = (event.target instanceof Element ? event.target : null)?.closest("button");
      event.preventDefault();
      if (button instanceof HTMLButtonElement && !button.disabled) button.click();
      focusedRef.current?.focus({ preventScroll: true });
      window.setTimeout(() => {
        keepFocusRef.current = false;
      }, 400);
    };
    const onClick = (event) => {
      if (!keepFocusRef.current || !event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    if (rowMenuId === null) return;
    const button = document.querySelector(MORE_OPEN);
    if (button instanceof HTMLButtonElement) placeRowMenu(button);
  }, [editing, rowMenuId, rows]);

  // The page itself never scrolls.
  useEffect(() => {
    const resetScroll = () => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", resetScroll, { passive: true });
    const viewport = window.visualViewport;
    viewport?.addEventListener("scroll", resetScroll);
    return () => {
      window.removeEventListener("scroll", resetScroll);
      viewport?.removeEventListener("scroll", resetScroll);
    };
  }, []);

  // Update check: if the server that served this page runs another version, reload the same address
  // with that ?v= (index.html is served with no-cache and its assets carry ?v=, so they come fresh).
  // Once only: an address that already has that ?v= stays. A failed check shows nothing. Pages has
  // no server of its own and updates on its own deploy, so the check is skipped there.
  useEffect(() => {
    if (onPages()) return;
    fetch(`${apiOrigin()}/health`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((health) => {
        const latest = String(health?.version || "");
        const url = new URL(location.href);
        if (!latest || latest === APP_VERSION || url.searchParams.get("v") === latest) return;
        url.searchParams.set("v", latest);
        location.replace(url.href);
      })
      .catch(() => {});
  }, []);

  // Start-up: load the draft (?draft= or start_param) or the progress slot, apply the theme,
  // initialise Telegram and block pinch zoom.
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get("draft") || "";
    const fromStart = window.Telegram?.WebApp?.initDataUnsafe?.start_param || "";
    const draftId = [fromUrl, fromStart].find((value) => DRAFT_ID.test(value)) || "";
    if (draftId) draftIdRef.current = draftId;
    apiRequest("GET", draftId ? `/drafts/${draftId}` : "/drafts/progress").then((result) => {
      if (!result.ok) return;
      const project = result.data;
      if (!project?.rows?.length) return;
      const list = normalizeRows(project.rows.slice(0, ROW_COUNT).map(rowFromDraft));
      rowsRef.current = list;
      setRows(list);
      if (typeof project.seconds == "number") {
        secondsRef.current = project.seconds;
        setSeconds(project.seconds);
      }
      if (project.patch) {
        const sound = { ...DEFAULT_PATCH, ...project.patch, mode: "custom", bpm: clampBpm(project.patch.bpm) };
        patchRef.current = sound;
        setPatch(sound);
      }
    });

    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    let picked = "";
    try {
      picked = sessionStorage.getItem(THEME_KEY) || "";
    } catch {}
    const theme = picked === "dark" || picked === "light" ? picked : scheme.matches ? "dark" : "light";
    applyTheme(theme);
    setDark(theme === "dark");
    // A change of the system theme drops the manual choice and follows the system.
    const onSchemeChange = () => {
      try {
        sessionStorage.removeItem(THEME_KEY);
      } catch {}
      const next = scheme.matches ? "dark" : "light";
      applyTheme(next);
      setDark(next === "dark");
    };
    scheme.addEventListener("change", onSchemeChange);

    const webApp = telegramApp();
    webApp?.ready();
    webApp?.expand();
    try {
      webApp?.disableVerticalSwipes?.();
    } catch {}

    const blockGesture = (event) => event.preventDefault();
    document.addEventListener("gesturestart", blockGesture);
    document.addEventListener("gesturechange", blockGesture);
    const blockPinch = (event) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    document.addEventListener("touchmove", blockPinch, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", blockGesture);
      document.removeEventListener("gesturechange", blockGesture);
      document.removeEventListener("touchmove", blockPinch);
      scheme.removeEventListener("change", onSchemeChange);
      window.clearTimeout(autosaveRef.current);
    };
  }, []);

  // Plane animation loop; also advances the playhead while playing.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const audio = audioRef.current;
      if (playingRef.current && audio) playheadRef.current = audio.origin + (audio.ctx.currentTime - audio.started);
      const scale = drawPlane(canvas, ctx, {
        time: playheadRef.current,
        patch: patchRef.current,
        rows: rowsRef.current,
        compiled: compiledRef.current,
        overflow: overflowRef.current,
      });
      scaleRef.current = scale;
      if (audio && Math.abs(scale - sentScaleRef.current) > 0.05) {
        sentScaleRef.current = scale;
        audio.node.port.postMessage({ scale });
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Header clock (position inside the song length), refreshed five times a second.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const length = Math.max(1, secondsRef.current);
      const now = playheadRef.current % length;
      setClock((prev) => (Math.abs(prev - now) < 0.04 ? prev : now));
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  // Close the menus on an outside tap or Escape.
  useEffect(() => {
    if (!menu && rowMenuId === null) return;
    const onPointerDown = (event) => {
      const target = event.target;
      if (!target || headerRef.current?.contains(target) || target.closest(".sh-menu") || target.closest(".more") || target.closest(".row-pop")) {
        return;
      }
      setMenu(null);
      setRowMenuId(null);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenu(null);
        setRowMenuId(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, rowMenuId]);

  // State sent to the mdjr-mix processor (web/worklet.js).
  function workletMessage(time) {
    const sound = patchRef.current;
    const message = {
      scale: scaleRef.current,
      patch: {
        x: sound.x,
        y: sound.y,
        z: sound.z,
        w: sound.w,
        a: sound.a,
        b: sound.b,
        g: sound.g,
        d: sound.d,
        lpf: sound.lpf,
        res: sound.res,
        muted: sound.muted,
      },
      rows: rowsRef.current.map((row, i) => {
        const on = !!(row.on && compiledRef.current[i]?.ok && !overflowRef.current[i]);
        return { on, bpm: row.bpm, vol: row.vol, js: on ? compiledRef.current[i].js : "" };
      }),
    };
    if (typeof time == "number") message.t = time;
    return message;
  }

  function stopAudio() {
    const audio = audioRef.current;
    playingRef.current = false;
    setPlaying(false);
    if (audio) {
      audio.node.port.onmessage = null;
      audio.node.disconnect();
      audio.ctx.close();
      audioRef.current = null;
    }
  }

  async function togglePlay() {
    if (playingRef.current) {
      stopAudio();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setMark("sem áudio");
      return;
    }
    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") await ctx.resume();
    if (!ctx.audioWorklet) {
      setMark("sem áudio");
      ctx.close();
      return;
    }
    try {
      await ctx.audioWorklet.addModule(new URL(`./worklet.js?v=${APP_VERSION}`, location.href).href);
    } catch {
      setMark("sem áudio");
      ctx.close();
      return;
    }
    const node = new AudioWorkletNode(ctx, "mdjr-mix");
    const origin = playheadRef.current;
    node.port.postMessage(workletMessage(origin));
    node.connect(ctx.destination);
    sentScaleRef.current = scaleRef.current;
    audioRef.current = { ctx, node, origin, started: ctx.currentTime };
    playingRef.current = true;
    setPlaying(true);
    setMark("");
  }

  // Space toggles playback (except while typing).
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.code !== "Space") return;
      event.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stopAudio();
    };
  }, []);

  function setRowBpm(index, value) {
    const list = rowsRef.current.slice();
    const row = list[index];
    if (!row) return;
    list[index] = { ...row, bpm: clampBpm(value) };
    commitRows(list);
  }

  function setRowVolume(index, percent) {
    const list = rowsRef.current.slice();
    const row = list[index];
    if (!row) return;
    list[index] = { ...row, vol: clampVolume(percent / 100) };
    commitRows(list);
  }

  // Play button of a row: while playing it mutes/unmutes the row; when stopped it turns the row on and starts playback.
  function toggleRow(index) {
    const row = rowsRef.current[index];
    if (!row) return;
    if (row.on && playingRef.current) {
      const list = rowsRef.current.slice();
      list[index] = { ...row, on: false };
      commitRows(list);
      setRowMenuId((open) => (open === row.id ? null : open));
      return;
    }
    const list = rowsRef.current.slice();
    list[index] = { ...row, on: true };
    commitRows(list);
    if (!playingRef.current) togglePlay();
  }

  // Download: renders the song offline (same mix, filter and scale as playback), encodes MP3
  // 128 kbps mono, and inside Telegram sends it to the chat through /song; otherwise downloads it.
  async function exportSong() {
    if (exporting) return;
    setExporting(true);
    setMenu(null);
    try {
      const sound = patchRef.current;
      const list = rowsRef.current.slice();
      const voices = list.map((row) => compileRow(row.y));
      const length = secondsRef.current;
      const lowpass = createLowpass(SAMPLE_RATE);
      const dcBlock = createDcBlock();
      lowpass.set(sound.lpf, sound.res);
      const gain = sound.muted ? 0 : 1;
      const blob = await encodeMp3(Math.floor(length * SAMPLE_RATE), SAMPLE_RATE, (offset, block) => {
        for (let i = 0; i < block.length; i++) {
          const mixed = mixSample((offset + i) / SAMPLE_RATE, list, voices, sound);
          block[i] = Math.max(-0.98, Math.min(0.98, lowpass.process(dcBlock(mixed / Math.max(1, scaleRef.current))) * gain));
        }
      });
      const filename = `math-dj-${formatTime(length).replace(":", "m")}.mp3`;
      const webApp = telegramApp();
      const origin = apiOrigin();
      if (webApp?.initData && origin) {
        const response = await fetch(`${origin}/song`, {
          method: "POST",
          headers: { "content-type": "audio/mpeg", "x-telegram-init-data": webApp.initData, "x-filename": filename },
          body: blob,
        });
        setMark(response.ok ? "sent" : "failed");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setMark("");
    } catch {
      setMark("failed");
    } finally {
      setExporting(false);
    }
  }

  // pointerdown inside the bar and menus: keep the keyboard open on buttons, and let the custom
  // sliders (.bpm-slider) follow the finger from the first touch.
  function onMenuPointerDown(event) {
    const target = event.target;
    if (!target) return;
    if (target.closest("button")) {
      event.preventDefault();
      return;
    }
    const slider = target.closest(".bpm-slider");
    if (!slider) return;
    event.preventDefault();
    const input = slider.querySelector("input");
    if (!input) return;
    const min = Number(input.min);
    const max = Number(input.max);
    const index = rowsRef.current.findIndex((row) => row.id === rowMenuId);
    const apply = input.getAttribute("aria-label") === "Volume" ? (value) => setRowVolume(index, value) : (value) => setRowBpm(index, value);
    const follow = (clientX) => {
      const box = slider.getBoundingClientRect();
      const ratio = box.width ? Math.min(1, Math.max(0, (clientX - box.left) / box.width)) : 0;
      apply(Math.round(min + ratio * (max - min)));
    };
    follow(event.clientX);
    const onMove = (move) => follow(move.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function openDraft(draft) {
    apiRequest("GET", `/drafts/${draft.id}`).then((result) => {
      if (!result.ok || !result.data?.rows?.length) return;
      const project = result.data;
      draftIdRef.current = draft.id;
      commitRows(normalizeRows(project.rows.map(rowFromDraft)));
      if (project.seconds) {
        secondsRef.current = project.seconds;
        setSeconds(project.seconds);
      }
      if (project.patch) {
        const sound = { ...DEFAULT_PATCH, ...project.patch, bpm: clampBpm(project.patch.bpm) };
        patchRef.current = sound;
        setPatch(sound);
      }
      setMenu(null);
      setMark(draft.name);
    });
  }

  function saveDraft() {
    const id = draftIdRef.current;
    apiRequest("POST", id ? `/drafts/${id}` : "/drafts", {
      name: draftName(rowsRef.current),
      rows: rowsRef.current,
      seconds: secondsRef.current,
      patch: patchRef.current,
    }).then((result) => {
      if (!result.ok || !result.data?.id) return;
      const saved = result.data;
      draftIdRef.current = saved.id;
      setDrafts((list) => [{ id: saved.id, name: saved.name, updated: saved.updated }, ...list.filter((d) => d.id !== saved.id)].slice(0, 5));
      setMark(saved.name);
    });
  }

  function renderMenu() {
    return (
      <Glass
        className="sh-picker tint-bar glass"
        optics={GLASS_BAR}
        role="menu"
        onPointerDown={onMenuPointerDown}
        style={{ position: "absolute", top: 8, left: 8, borderRadius: 16 }}
      >
        {menu === "root" ? (
          <div className="menu-list">
            <button type="button" onClick={() => setMenu("tempo")}>
              Time <span>›</span>
            </button>
            <button
              type="button"
              onClick={() => {
                generateRow(Math.max(0, rowsRef.current.length - 1));
                setMenu(null);
              }}
            >
              New
            </button>
            <button
              type="button"
              onClick={() => {
                const sound = { ...patchRef.current, muted: !patchRef.current.muted };
                patchRef.current = sound;
                setPatch(sound);
                scheduleAutosave(rowsRef.current, secondsRef.current, sound);
                setMenu(null);
              }}
            >
              {patch.muted ? "Sound" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenu("drafts");
                apiRequest("GET", "/drafts").then((result) => {
                  if (!result.ok || !Array.isArray(result.data)) return;
                  setDrafts(result.data);
                });
              }}
            >
              Drafts <span>›</span>
            </button>
          </div>
        ) : null}
        {menu === "drafts" ? (
          <div className="menu-list">
            <button type="button" onClick={() => setMenu("root")}>
              ‹ Drafts
            </button>
            <button type="button" onClick={saveDraft}>
              Save
            </button>
            {drafts.map((draft) => (
              <button key={draft.id} type="button" onClick={() => openDraft(draft)}>
                {draft.name}
              </button>
            ))}
            {drafts.length ? null : (
              <button type="button" disabled>
                None yet
              </button>
            )}
          </div>
        ) : null}
        {menu === "tempo" ? (
          <div className="menu-list">
            <button type="button" onClick={() => setMenu("root")}>
              ‹ Time
            </button>
            {DURATIONS.map((length) => (
              <button
                key={length}
                type="button"
                data-on={seconds === length ? "1" : undefined}
                onClick={() => {
                  secondsRef.current = length;
                  setSeconds(length);
                  scheduleAutosave(rowsRef.current, length, patchRef.current);
                  setMenu(null);
                }}
              >
                {formatTime(length)}
              </button>
            ))}
          </div>
        ) : null}
      </Glass>
    );
  }

  // Slider shared by the BPM and Volume pages of the row menu.
  function renderSlider(label, value, min, max, position, onChange) {
    return (
      <label className="bpm">
        <b>
          {`${label} `}
          <span>{value}</span>
        </b>
        <span className="bpm-slider">
          <i className="bpm-track" />
          <i className="bpm-thumb" style={{ left: `calc(22px + (100% - 44px) * ${position})` }} />
          <input type="range" min={min} max={max} step={1} value={value} aria-label={label} onChange={onChange} />
        </span>
      </label>
    );
  }

  function renderRowMenu() {
    const index = rows.findIndex((row) => row.id === rowMenuId);
    const row = rows[index];
    if (!row || !row.on || !playing) return null;
    const bpm = clampBpm(row.bpm);
    const bpmPosition = (bpm - 80) / 100;
    const volume = Math.round(clampVolume(row.vol) * 100);
    return (
      <Glass
        className="sh-picker tint-bar glass row-pop"
        optics={GLASS_BAR}
        role="menu"
        onPointerDown={onMenuPointerDown}
        style={{
          position: "fixed",
          borderRadius: 16,
          right: rowMenuBox.right,
          left: "auto",
          width: "max-content",
          maxWidth: "calc(100vw - 16px)",
          zIndex: 80,
          overflow: "hidden",
          padding: 0,
          top: rowMenuBox.top ?? "auto",
          bottom: rowMenuBox.bottom ?? "auto",
        }}
      >
        <div className="menu-scroll" style={{ maxHeight: rowMenuBox.max }}>
          {rowMenuPage === "root" ? (
            <div className="menu-list">
              <button type="button" onClick={() => setRowMenuPage("bpm")}>
                BPM <span>›</span>
              </button>
              <button type="button" onClick={() => setRowMenuPage("vol")}>
                Volume <span>›</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  generateRow(index);
                  setRowMenuId(null);
                }}
              >
                Generate
              </button>
            </div>
          ) : null}
          {rowMenuPage === "bpm" ? (
            <div className="menu-list">
              <button type="button" onClick={() => setRowMenuPage("root")}>
                ‹ BPM
              </button>
              {renderSlider("BPM", bpm, 80, 180, bpmPosition, (event) => setRowBpm(index, Number(event.target.value)))}
            </div>
          ) : null}
          {rowMenuPage === "vol" ? (
            <div className="menu-list">
              <button type="button" onClick={() => setRowMenuPage("root")}>
                ‹ Volume
              </button>
              {renderSlider("Volume", volume, 0, 100, volume / 100, (event) => setRowVolume(index, Number(event.target.value)))}
            </div>
          ) : null}
        </div>
      </Glass>
    );
  }

  function renderRow(row, index) {
    const live = row.on && playing;
    const menuOpen = rowMenuId === row.id && live;
    const error = compiled[index]?.ok ? (overflow[index] ? "3 LINHAS" : "") : compiled[index]?.error || "SINTAXE";
    return (
      <Glass
        key={row.id}
        className="fn-row tint-bar glass"
        optics={GLASS_BAR}
        data-off={row.on ? undefined : "1"}
        data-invalid={error ? "1" : undefined}
        style={{ borderRadius: 23 }}
      >
        <button
          type="button"
          className="sh-pill play-in"
          aria-label={live ? "Pause" : "Play"}
          aria-pressed={live}
          onPointerDown={onMenuPointerDown}
          onClick={() => toggleRow(index)}
        >
          <Icon d={live ? ICONS.pause : ICONS.play} />
        </button>
        <span>y =</span>
        <i className="swatch" style={{ background: row.color }} />
        <textarea
          value={row.y}
          rows={3}
          spellCheck={false}
          aria-label={`y${index + 1}`}
          aria-invalid={error ? true : undefined}
          onFocus={(event) => {
            focusedRef.current = event.currentTarget;
            focusedAtRef.current = Date.now();
            window.scrollTo(0, 0);
            editingRef.current = true;
            setEditing(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (keepFocusRef.current) {
                focusedRef.current?.focus({ preventScroll: true });
                return;
              }
              if (!(document.activeElement instanceof HTMLTextAreaElement)) setEditing(false);
            }, 60);
          }}
          onScroll={(event) => {
            event.currentTarget.scrollTop = 0;
          }}
          onChange={(event) => {
            event.target.scrollTop = 0;
            const list = rowsRef.current.slice();
            list[index] = { ...row, y: event.target.value };
            commitRows(list);
          }}
        />
        {error ? <b className="fn-err">{error}</b> : null}
        <button
          type="button"
          className="sh-pill more"
          aria-label="Formula"
          aria-expanded={menuOpen}
          disabled={!live}
          onPointerDown={onMenuPointerDown}
          onClick={(event) => {
            if (!live) return;
            if (menuOpen) {
              setRowMenuId(null);
              return;
            }
            setMenu(null);
            setRowMenuPage("root");
            placeRowMenu(event.currentTarget);
            setRowMenuId(row.id);
          }}
        >
          <Icon d={ICONS.more} />
        </button>
      </Glass>
    );
  }

  return (
    <div className="dj" data-edit={editing ? "1" : undefined}>
      <header className="site-header">
        <div className="sh-anchor" ref={headerRef}>
          <Glass className="sh-bar tint-bar glass" optics={GLASS_BAR} style={{ width: "100%", borderRadius: 26 }}>
            <button
              type="button"
              className="sh-pill sh-menu"
              aria-label="Menu"
              aria-expanded={menu !== null}
              onPointerDown={onMenuPointerDown}
              onClick={() => {
                setRowMenuId(null);
                setMenu(menu ? null : "root");
              }}
            >
              <Icon d={ICONS.menu} />
            </button>
            <span className="sh-time">
              {formatTime(clock)} / {formatTime(seconds)}
            </span>
            <div className="sh-actions">
              <button
                type="button"
                className="sh-pill"
                aria-label="Download"
                disabled={exporting}
                onClick={() => {
                  exportSong();
                }}
              >
                <Icon d={ICONS.down} />
              </button>
              <button
                type="button"
                className="sh-pill"
                aria-label={dark ? "Light" : "Dark"}
                onClick={() => {
                  const next = dark ? "light" : "dark";
                  try {
                    sessionStorage.setItem(THEME_KEY, next);
                  } catch {}
                  applyTheme(next);
                  setDark(next === "dark");
                }}
              >
                <ThemeIcon dark={dark} />
              </button>
            </div>
          </Glass>
          {menu ? renderMenu() : null}
          {rowMenuId !== null ? createPortal(renderRowMenu(), document.body) : null}
        </div>
      </header>
      <div className="plane" hidden={editing}>
        <Glass className="plane-card tint-bar glass" optics={GLASS_BAR} style={{ borderRadius: 23 }}>
          <canvas ref={canvasRef} />
          {mark ? <b className="mark">{mark}</b> : null}
        </Glass>
      </div>
      <div className="expr-dock">
        <div className="fn-stack">{rows.map(renderRow)}</div>
      </div>
    </div>
  );
}
