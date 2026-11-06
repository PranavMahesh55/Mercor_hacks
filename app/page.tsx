"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronDown,
  Clipboard,
  Clock3,
  Expand,
  Film,
  Flag,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ScanLine,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import {
  APPROVED_SCRIPT,
  CATEGORY_LABELS,
  DEMO_BRIEF,
  GENERATION_PROMPT,
} from "@/lib/demo";
import {
  MAX_VIDEO_BYTES,
  CHECKER_VERSION,
  requirementsFromBrief,
  correctionBrief,
  formatTime,
  type Finding,
  type Review,
} from "@/lib/review";
import {
  cacheIdentity,
  deleteProject,
  listProjects,
  saveProject,
  type SavedProject,
} from "@/lib/storage";

import { mediaFindings } from "@/lib/media-signals";

type Tab = "findings" | "transcript" | "brief";
type Modal = "settings" | "new" | "demo" | "export" | null;
type Model = { id: string; name: string };

function download(name: string, content: string) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function metadata(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const d = v.duration;
      URL.revokeObjectURL(url);
      Number.isFinite(d) && d > 0
        ? resolve(d)
        : reject(new Error("Cannot read video duration. Use a standard MP4."));
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "Your browser cannot decode this video. Convert it to MP4 first.",
        ),
      );
    };
    v.src = url;
  });
}
async function evidenceFrames(
  blob: Blob,
  findings: Finding[],
): Promise<Finding[]> {
  if (!findings.length) return findings;
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  const url = URL.createObjectURL(blob);
  v.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Frame extraction timed out.")),
        12000,
      );
      v.onloadeddata = () => {
        clearTimeout(timeout);
        resolve();
      };
      v.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Frame extraction unavailable."));
      };
    });
    const result: Finding[] = [];
    for (const f of findings) {
      const times =
        f.evidenceType === "speech"
          ? [f.start]
          : [
              f.start + 0.1,
              (f.start + f.end) / 2,
              Math.max(f.start, f.end - 0.1),
            ];
      const frames: { time: number; image: string }[] = [];
      for (const raw of [...new Set(times)]) {
        try {
          const t = Math.min(Math.max(0, raw), v.duration - 0.05);
          if (Math.abs(v.currentTime - t) > 0.01)
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error("Seek timed out.")),
                4000,
              );
              v.onseeked = () => {
                clearTimeout(timeout);
                resolve();
              };
              v.currentTime = t;
            });
          const canvas = document.createElement("canvas");
          canvas.width = 960;
          canvas.height = Math.round((960 * v.videoHeight) / v.videoWidth);
          canvas
            .getContext("2d")
            ?.drawImage(v, 0, 0, canvas.width, canvas.height);
          frames.push({ time: t, image: canvas.toDataURL("image/jpeg", 0.85) });
        } catch {
          /* Keep other actual frames; never substitute generated evidence. */
        }
      }
      result.push({
        ...f,
        frame: frames[0]?.image,
        frameTime: frames[0]?.time,
        evidenceFrames: frames,
      });
    }
    return result;
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

export default function Home() {
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [project, setProject] = useState<SavedProject | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [source, setSource] = useState("");
  const [tab, setTab] = useState<Tab>("findings");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [key, setKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [brief, setBrief] = useState(DEMO_BRIEF);
  const [script, setScript] = useState(APPROVED_SCRIPT);
  const [mode, setMode] = useState("meaning");
  const [refs, setRefs] = useState<File[]>([]);
  const [refsChanged, setRefsChanged] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [replay, setReplay] = useState(false);
  const [wide, setWide] = useState(false);
  const [generationStart, setGenerationStart] = useState<number | null>(null);
  const [generationMs, setGenerationMs] = useState<number | null>(null);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<AbortController | null>(null);
  const uploadToken = useRef(0);
  const current = review?.findings.find((f) => f.id === selected) ?? null;
  const changed =
    !!review &&
    (brief !== review.brief ||
      script !== review.script ||
      mode !== review.scriptMode ||
      refsChanged ||
      (connected && model !== review.model));
  const visible = (review?.findings ?? []).filter(
    (f) =>
      filter === "all" ||
      (filter === "fixes"
        ? f.category !== "creative" && f.requirementId !== "MEDIA"
        : filter === "playback"
          ? f.requirementId === "MEDIA"
          : f.category === filter),
  );
  const unresolved =
    review?.findings.filter((f) => f.reviewStatus === "unreviewed").length ?? 0;
  const confirmed =
    review?.findings.filter((f) => f.reviewStatus === "confirmed").length ?? 0;
  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!project) return;
    const url = URL.createObjectURL(project.file);
    setSource(url);
    setTime(0);
    setPlaying(false);
    return () => URL.revokeObjectURL(url);
  }, [project?.id]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!generationStart) return;
    const timer = setInterval(
      () => setGenerationElapsed(Date.now() - generationStart),
      1000,
    );
    return () => clearInterval(timer);
  }, [generationStart]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  async function persist(next: SavedProject) {
    setProject(next);
    try {
      await saveProject(next);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function pick(f: File) {
    const token = ++uploadToken.current;
    setError("");
    setUploading(true);
    try {
      if (f.size > MAX_VIDEO_BYTES)
        throw new Error(
          "Use a video under 14 MB. Export a 720p MP4 for a short demo.",
        );
      if (!["video/mp4", "video/webm", "video/quicktime"].includes(f.type))
        throw new Error("Choose MP4, WebM, or MOV. MP4 works best.");
      const d = await metadata(f);
      if (d > 60.5)
        throw new Error("The first version supports videos up to 60 seconds.");
      if (token !== uploadToken.current) return;
      const next: SavedProject = {
        id: crypto.randomUUID(),
        name: f.name,
        file: f,
        type: f.type,
        duration: d,
        brief,
        script,
        review: null,
        createdAt: new Date().toISOString(),
        generationMs,
        references: refs,
        scriptMode: mode,
      };
      setReview(null);
      setSelected(null);
      setReplay(false);
      setRefsChanged(false);
      setFile(f);
      setTab("brief");
      await persist(next);
      setModal(null);
      setNotice("Video ready. Check the approved brief, then run review.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (token === uploadToken.current) setUploading(false);
    }
  }
  async function loadTalkingHead(stress: boolean) {
    try {
      const r = await fetch(
        `/demo/talking-head-${stress ? "stress" : "clean"}.mp4`,
      );
      if (!r.ok) throw new Error("Could not load the talking-head sample.");
      const blob = await r.blob();
      await pick(
        new File(
          [blob],
          stress
            ? "talking-head-controlled-freeze-and-mute.mp4"
            : "talking-head-clean-control.mp4",
          { type: "video/mp4" },
        ),
      );
      setBrief(
        "A casual direct-to-camera product introduction for a short social ad. Review spoken delivery and visual continuity. The source is a public HeyGen avatar example, not a Mercor campaign or our generation.",
      );
      setNotice(
        stress
          ? "Controlled stress test: a freeze and muted section were added to test detection. Run picture & audio checks."
          : "Clean talking-head control. Run picture & audio checks; a clean result is valid.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadFixture() {
    try {
      const response = await fetch("/demo/visual-check-fixture.mp4");
      if (!response.ok) throw new Error("Could not load the diagnostic clip.");
      const blob = await response.blob();
      await pick(
        new File([blob], "visual-check-fixture.mp4", { type: "video/mp4" }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadInternalReplay() {
    const controller = new AbortController();
    cancel.current = controller;
    setBusy(true);
    setError("");
    setModal(null);
    setPhase("Opening the internal-agent diagnostic");
    try {
      const [videoResponse, reportResponse] = await Promise.all([
        fetch("/demo/visual-check-fixture.mp4", { signal: controller.signal }),
        fetch("/demo/internal-agent-review.json", {
          signal: controller.signal,
        }),
      ]);
      if (!videoResponse.ok || !reportResponse.ok)
        throw new Error("The diagnostic assets could not load.");
      const blob = await videoResponse.blob();
      const result = (await reportResponse.json()) as Review & {
        sourceSha256: string;
      };
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
      )
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== result.sourceSha256)
        throw new Error("The saved diagnostic does not match this video.");
      setPhase("Extracting the actual source frames");
      result.findings = await evidenceFrames(blob, result.findings);
      try {
        const { verifyTextWithOcr } = await import("@/lib/ocr");
        const ocr = await verifyTextWithOcr(
          result.findings,
          setPhase,
          controller.signal,
        );
        result.findings = ocr.findings;
        result.limitations.push(...ocr.limitations);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        result.limitations.push(
          "Browser OCR unavailable; the stored diagnostic includes the independent local OCR record.",
        );
      }
      if (controller.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      const next: SavedProject = {
        id: crypto.randomUUID(),
        name: result.videoName,
        file: blob,
        type: "video/mp4",
        duration: result.duration,
        brief: result.brief,
        script: "",
        review: result,
        createdAt: new Date().toISOString(),
        generationMs: null,
        references: [],
        scriptMode: "meaning",
      };
      setReview(result);
      setBrief(result.brief);
      setScript("");
      setMode("meaning");
      setRefs([]);
      setRefsChanged(false);
      setSelected(result.findings[0]?.id ?? null);
      setReplay(true);
      setTab("findings");
      setFilter("all");
      await persist(next);
      setNotice(
        "Internal-agent diagnostic replay loaded. This was not a Gemini run.",
      );
    } catch (e) {
      setError(
        (e as Error).name === "AbortError"
          ? "Diagnostic cancelled."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      setPhase("");
      cancel.current = null;
    }
  }
  function openProject(p: SavedProject) {
    if (busy) return;
    setProject(p);
    setReview(p.review);
    setBrief(p.brief);
    setScript(p.script);
    setRefs(p.references ?? []);
    setRefsChanged(false);
    setMode(p.scriptMode ?? "meaning");
    setFile(null);
    setSelected(p.review?.findings[0]?.id ?? null);
    setReplay(!!p.review);
    setTab("findings");
    setFilter("all");
    setGenerationMs(p.generationMs);
    setError("");
  }
  async function connect() {
    setConnecting(true);
    setError("");
    try {
      const r = await fetch("/api/connection", {
        method: "POST",
        headers: { "x-review-key": key },
      });
      const d = (await r.json()) as {
        error?: string;
        models?: Model[];
        preferredModel?: string;
      };
      if (!r.ok) throw new Error(d.error || "Connection failed.");
      if (!d.models?.length)
        throw new Error("No supported Gemini models available for this key.");
      const list = d.models as Model[];
      setModels(list);
      const preferred =
        list
          .filter((m) => /^gemini-[0-9.]+-flash$/.test(m.id))
          .sort((a, b) =>
            b.id.localeCompare(a.id, undefined, { numeric: true }),
          )[0] ?? list[0];
      setModel(d.preferredModel ?? preferred.id);
      setConnected(true);
      setNotice("Gemini connected for this tab.");
    } catch (e) {
      setConnected(false);
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }
  async function localReview(signal: AbortSignal): Promise<Review> {
    if (!project) throw new Error("Choose a video first.");
    const { scanMedia } = await import("@/lib/media-scan");
    const scan = await scanMedia(project.file, setPhase, signal);
    const findings = await evidenceFrames(project.file, mediaFindings(scan));
    return {
      id: crypto.randomUUID(),
      videoName: project.name,
      duration: project.duration,
      createdAt: new Date().toISOString(),
      model: "Local picture and audio checks",
      brief,
      script,
      requirements: requirementsFromBrief(brief),
      findings,
      transcript: [],
      checks: requirementsFromBrief(brief).map((r) => ({
        requirementId: r.id,
        status: "cannot_verify" as const,
        detail:
          "Campaign meaning has not been reviewed. Connect Gemini for speech and brief checks.",
      })),
      limitations: [
        ...scan.limitations,
        "This is a local playback scan. Campaign meaning, spoken claims, gesture appropriateness and subjective delivery have not been evaluated.",
      ],
      analysisMs: scan.ms,
      tokens: null,
      version: CHECKER_VERSION,
      scriptMode: mode,
      passes: [
        {
          name: "Local face, motion and audio scan",
          status: "complete",
          ms: scan.ms,
        },
      ],
      cacheKey: "",
      referenceNames: [],
      mediaScan: scan,
    };
  }
  async function run(force = false) {
    if (!project) return;
    if (!brief.trim()) {
      setError("Add the approved requirements before running review.");
      return;
    }
    const clientStarted = performance.now();
    setBusy(true);
    setElapsed(0);
    setError("");
    setPhase("Checking saved analysis");
    const controller = new AbortController();
    cancel.current = controller;
    try {
      if (!connected || !key || !model) {
        const local = await localReview(controller.signal);
        if (controller.signal.aborted)
          throw new DOMException("Cancelled", "AbortError");
        local.endToEndMs = Math.round(performance.now() - clientStarted);
        setReview(local);
        setSelected(local.findings[0]?.id ?? null);
        setReplay(false);
        setTab("findings");
        setFilter("all");
        await persist({
          ...project,
          brief,
          script,
          review: local,
          references: refs,
          scriptMode: mode,
        });
        setNotice(
          "Picture and audio checked locally. Connect AI review for campaign and spoken-content checks.",
        );
        return;
      }
      const identity = await cacheIdentity(
        project.file,
        brief,
        script,
        model,
        refs,
        mode,
      );
      if (!force && project.review?.cacheKey === identity) {
        setReview(project.review);
        setReplay(true);
        setTab("findings");
        setSelected(project.review.findings[0]?.id ?? null);
        setNotice("Loaded saved analysis for these exact inputs.");
        return;
      }
      let local: Review | null = null;
      let localFailure = "";
      try {
        local = await localReview(controller.signal);
        setReview(local);
        setSelected(local.findings[0]?.id ?? null);
        setTab("findings");
        setReplay(false);
        await persist({
          ...project,
          brief,
          script,
          review: local,
          references: refs,
          scriptMode: mode,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        localFailure =
          "Local face, motion and audio scan did not complete. Inspect playback manually.";
      }
      setPhase("Gemini is checking speech, delivery and the campaign brief");
      const data = new FormData();
      data.append(
        "video",
        new File([project.file], project.name, { type: project.type }),
      );
      data.append("brief", brief);
      data.append("script", script);
      data.append("model", model);
      data.append("mode", mode);
      data.append("duration", String(project.duration));
      refs.forEach((f) => data.append("references", f));
      const r = await fetch("/api/review", {
        method: "POST",
        headers: { "x-review-key": key },
        body: data,
        signal: controller.signal,
      });
      const payload = (await r.json()) as Review & { error?: string };
      if (!r.ok) throw new Error(payload.error || "Review failed.");
      setPhase("Extracting evidence frames");
      const result: Review = {
        ...payload,
        cacheKey: identity,
        findings: [...(local?.findings ?? []), ...payload.findings],
        limitations: [
          ...payload.limitations,
          ...(local?.mediaScan?.limitations ?? [localFailure]),
        ],
        passes: [...(local?.passes ?? []), ...payload.passes],
        mediaScan: local?.mediaScan,
      };
      try {
        result.findings = await evidenceFrames(project.file, result.findings);
      } catch {
        result.limitations.push(
          "Source-frame extraction failed in this browser. Verify the flagged moment in the player.",
        );
      }
      try {
        const ocrStarted = performance.now();
        setPhase("Checking visible text independently");
        const { verifyTextWithOcr } = await import("@/lib/ocr");
        const ocr = await verifyTextWithOcr(
          result.findings,
          setPhase,
          controller.signal,
        );
        result.findings = ocr.findings;
        result.limitations.push(...ocr.limitations);
        if (ocr.checked)
          result.passes.push({
            name: `Independent OCR: ${ocr.supported}/${ocr.checked} quotes reproduced`,
            status: "complete",
            ms: Math.round(performance.now() - ocrStarted),
          });
      } catch (ocrError) {
        if ((ocrError as Error).name === "AbortError") throw ocrError;
        result.limitations.push(
          "Independent OCR was unavailable in this browser. Model-only visual findings require manual verification.",
        );
      }
      result.endToEndMs = Math.round(performance.now() - clientStarted);
      if (controller.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      setReview(result);
      setSelected(result.findings[0]?.id ?? null);
      setReplay(false);
      setTab("findings");
      setFilter("all");
      await persist({
        ...project,
        brief,
        script,
        review: result,
        generationMs,
        references: refs,
        scriptMode: mode,
      });
      setRefsChanged(false);
      setNotice(
        "Review complete. Inspect the evidence before confirming findings.",
      );
    } catch (e) {
      setError(
        (e as Error).name === "AbortError"
          ? "Review cancelled. No new results were saved."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      setPhase("");
      cancel.current = null;
    }
  }
  function seek(t: number) {
    if (video.current) {
      video.current.currentTime = Math.min(
        Math.max(0, t),
        project?.duration ?? t,
      );
      setTime(t);
    }
  }
  function select(f: Finding) {
    setSelected(f.id);
    seek(f.start);
  }
  async function verdict(status: Finding["reviewStatus"]) {
    if (!review || !project || !selected) return;
    const next = {
      ...review,
      findings: review.findings.map((f) =>
        f.id === selected ? { ...f, reviewStatus: status } : f,
      ),
    };
    setReview(next);
    await persist({
      ...project,
      review: next,
      brief: review.brief,
      script: review.script,
    });
  }
  function togglePlay() {
    if (!video.current) return;
    if (video.current.paused)
      void video.current
        .play()
        .catch(() => setError("Playback failed. Use a supported MP4."));
    else video.current.pause();
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch {
      setWide(!wide);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      download("takecheck-brief.txt", text);
    }
  }
  async function remove(p: SavedProject) {
    if (!window.confirm(`Delete ${p.name} and its local review?`)) return;
    await deleteProject(p.id);
    if (project?.id === p.id) {
      setProject(null);
      setReview(null);
      setSource("");
    }
    await refresh();
  }

  return (
    <div className={`creator-app ${wide ? "theater" : ""}`}>
      <header className="creator-nav">
        <a className="creator-logo" href="/" aria-label="Takecheck home">
          <ScanLine size={25} />
          <span>
            takecheck<span className="logo-period">.</span>
          </span>
        </a>
        <div className="nav-caption">
          A second opinion for your first impression.
        </div>
        <div className="creator-nav-actions">
          <button onClick={() => setModal("new")} className="nav-link">
            <FolderOpen size={16} />
            <span>My drafts</span>
          </button>
          <button
            className={`engine-button ${connected ? "connected" : ""}`}
            onClick={() => setModal("settings")}
            aria-label={
              connected ? "AI connected — settings" : "Connect AI review"
            }
            title={connected ? "AI connected" : "Connect AI"}
          >
            <Settings2 size={17} />
            <i />
          </button>
        </div>
      </header>
      <main className="creator-main">
        <section className="creator-hero">
          <div>
            <div className="creator-eyebrow">
              <span className="live-dot" /> FOR THE WORK BEFORE YOU POST
            </div>
            <h1>
              {project ? (
                "Let’s check the take."
              ) : (
                <>
                  Made with AI.
                  <br />
                  <em>Reviewed with taste.</em>
                </>
              )}
            </h1>
            <p>
              {project
                ? "Your brief on one side. Your creative on the other. Catch what needs another take."
                : "Check your AI UGC against the campaign brief. Catch the off-brand details before they hit the feed."}
            </p>
          </div>
          <button className="campaign-example" onClick={() => setModal("demo")}>
            <span>
              <Sparkles size={17} /> THE MERCOR CAMPAIGN
            </span>
            <strong>
              A real brief.
              <br />
              An honest review.
            </strong>
            <b>
              Make a sample ad <ArrowRight size={17} />
            </b>
          </button>
        </section>
        {error && (
          <div className="creator-alert" role="alert">
            <Flag size={16} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {changed && (
          <div className="creator-notice">
            <RotateCcw size={15} />
            <span>
              You changed the brief or review settings. Run a new review to
              check this version.
            </span>
          </div>
        )}
        <div className={`creator-workbench ${review ? "has-results" : ""}`}>
          <section className="creative-column">
            <div className="creative-card">
              <div className="creative-card-header">
                <div>
                  <span className="step-number">01</span>
                  <strong>Your creative</strong>
                </div>
                {project ? (
                  <button
                    className="subtle-button"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    Replace video <Upload size={13} />
                  </button>
                ) : (
                  <span className="format-pill">9:16 looks good here</span>
                )}
              </div>
              <div
                ref={stage}
                className={`creator-stage ${source ? "with-video" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy && e.dataTransfer.files[0])
                    void pick(e.dataTransfer.files[0]);
                }}
              >
                {source ? (
                  <>
                    <video
                      ref={video}
                      src={source}
                      playsInline
                      muted={muted}
                      onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onEnded={() => setPlaying(false)}
                      onError={() =>
                        setError(
                          "This video could not play. Try a standard H.264 MP4.",
                        )
                      }
                      onLoadedData={(e) => {
                        if (e.currentTarget.currentTime === 0)
                          e.currentTarget.currentTime = 0.05;
                      }}
                      onClick={togglePlay}
                    />
                    <div className="clip-label">{project?.name}</div>
                    {!playing && (
                      <button
                        className="creator-play"
                        onClick={togglePlay}
                        aria-label="Play video"
                      >
                        <Play fill="currentColor" size={26} />
                      </button>
                    )}
                    <button
                      className="stage-expand"
                      onClick={() => void fullscreen()}
                      aria-label="Fullscreen video"
                    >
                      <Expand size={18} />
                    </button>
                    <div className="full-screen-controls">
                      <button
                        onClick={togglePlay}
                        aria-label={playing ? "Pause" : "Play"}
                      >
                        {playing ? <Pause /> : <Play />}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={project?.duration ?? 1}
                        value={time}
                        step={0.1}
                        onChange={(e) => seek(Number(e.target.value))}
                        aria-label="Fullscreen video position"
                      />
                      <span>{formatTime(time)}</span>
                      <button
                        onClick={() => void fullscreen()}
                        aria-label="Exit fullscreen"
                      >
                        <Maximize2 />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="creator-upload">
                    <div className="upload-symbol">
                      <Upload size={28} strokeWidth={1.6} />
                    </div>
                    <h2>Drop your next big thing.</h2>
                    <p>
                      A talking head. A product demo.
                      <br />
                      That almost-ready AI ad.
                    </p>
                    <button
                      className="cta dark"
                      onClick={() => fileInput.current?.click()}
                      disabled={uploading}
                    >
                      <Plus size={17} />
                      {uploading ? "Opening your draft…" : "Add your video"}
                    </button>
                    <small>
                      Drop a file here, or choose one
                      <br />
                      MP4, MOV, WebM · Up to 60s · 14 MB
                    </small>
                    <div className="platform-tags">
                      <span>Instagram Reels</span>
                      <span>TikTok</span>
                      <span>Shorts</span>
                    </div>
                  </div>
                )}
              </div>
              {project && (
                <>
                  <div className="creator-player-controls">
                    <button
                      onClick={togglePlay}
                      aria-label={playing ? "Pause" : "Play"}
                    >
                      {playing ? <Pause size={17} /> : <Play size={17} />}
                    </button>
                    <span>
                      {formatTime(time)}
                      <i> / {formatTime(project.duration)}</i>
                    </span>
                    <div className="control-spacer" />
                    <button
                      onClick={() => setMuted(!muted)}
                      aria-label={muted ? "Unmute" : "Mute"}
                    >
                      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <button
                      onClick={() => void fullscreen()}
                      aria-label="Enter fullscreen"
                    >
                      <Expand size={16} />
                    </button>
                  </div>
                  <div className="creator-timeline">
                    <div className="time-ruler">
                      {Array.from({ length: 5 }, (_, i) => (
                        <span key={i}>
                          {formatTime((project.duration * i) / 4)}
                        </span>
                      ))}
                    </div>
                    <div className="creator-track">
                      <div
                        className="track-fill"
                        style={{ width: `${(time / project.duration) * 100}%` }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={project.duration}
                        value={time}
                        step={0.05}
                        onChange={(e) => seek(Number(e.target.value))}
                        aria-label="Video timeline"
                      />
                      {review?.findings
                        .filter((f) => f.reviewStatus !== "dismissed")
                        .map((f, i) => (
                          <button
                            key={f.id}
                            className={`moment-flag ${f.category === "creative" ? "creative" : ""} ${selected === f.id ? "active" : ""}`}
                            style={{
                              left: `${(f.start / project.duration) * 100}%`,
                              width: `${Math.max(1.2, ((f.end - f.start) / project.duration) * 100)}%`,
                            }}
                            onClick={() => select(f)}
                            aria-label={`Jump to ${f.title} at ${formatTime(f.start)}`}
                            title={f.title}
                          >
                            <span>{i + 1}</span>
                          </button>
                        ))}
                      <div
                        className="creator-playhead"
                        style={{ left: `${(time / project.duration) * 100}%` }}
                      />
                    </div>
                    <div className="timeline-caption">
                      <span>
                        <i />
                        {review
                          ? "Click a marked moment to see why it was flagged."
                          : "Flagged moments will appear here."}
                      </span>
                      {replay && (
                        <span className="replay-label">Saved replay</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            {current && review && (
              <section className="moment-detail">
                <div className="moment-detail-top">
                  <span>
                    {current.category === "creative"
                      ? "A CREATIVE SUGGESTION"
                      : "LET’S LOOK CLOSER"}
                  </span>
                  <button onClick={() => seek(current.start)}>
                    {formatTime(current.start)}–{formatTime(current.end)}{" "}
                    <Play size={11} />
                  </button>
                </div>
                <h3>{current.title}</h3>
                <div className="moment-evidence">
                  {current.frame && (
                    <button
                      className="frame-proof"
                      onClick={() => seek(current.frameTime ?? current.start)}
                      aria-label="Show evidence frame"
                    >
                      <img
                        src={current.frame}
                        alt={`Source frame at approximately ${formatTime(current.start)}`}
                      />
                    </button>
                  )}
                  <div>
                    <span className="evidence-label">IN THE DRAFT</span>
                    <p className="actual-quote">“{current.observed}”</p>
                    <span className="evidence-label">
                      {current.requirementId === "MEDIA"
                        ? "PLAYBACK CHECK"
                        : "FROM YOUR BRIEF"}
                    </span>
                    <p>{current.expected}</p>
                  </div>
                </div>
                <p className="detail-explanation">{current.explanation}</p>
                {current.verification && (
                  <div
                    className={`verification-note ${current.verification.status === "supported" ? "supported" : "unconfirmed"}`}
                  >
                    <ShieldCheck size={14} />
                    <div>
                      <strong>
                        {current.verification.method === "local_media_scan"
                          ? "Measured from picture and audio"
                          : current.verification.method === "visual_reread"
                            ? "Visual cue repeated on a second look"
                            : current.verification.method === "tesseract_ocr"
                              ? current.verification.status === "supported"
                                ? "Independent text check matched"
                                : "Text check needs a human look"
                              : "Evidence reproduced on a blind reread"}
                      </strong>
                      <p>{current.verification.detail}</p>
                      {current.verification.ocrText && (
                        <details>
                          <summary>See extracted text</summary>
                          <pre>{current.verification.ocrText}</pre>
                        </details>
                      )}
                    </div>
                  </div>
                )}
                <div className="next-take">
                  <Sparkles size={16} />
                  <p>
                    <strong>For the next take</strong>
                    {current.suggestion}
                  </p>
                </div>
                <div className="review-decisions">
                  <button
                    className={`cta ${current.reviewStatus === "confirmed" ? "purple" : "outline"}`}
                    onClick={() => void verdict("confirmed")}
                  >
                    <Check size={15} />
                    {current.reviewStatus === "confirmed"
                      ? "Added to changes"
                      : "Add to changes"}
                  </button>
                  <button
                    className="subtle-button"
                    onClick={() => void verdict("dismissed")}
                  >
                    {current.reviewStatus === "dismissed"
                      ? "Dismissed"
                      : "Looks fine"}{" "}
                    <X size={13} />
                  </button>
                  {current.reviewStatus !== "unreviewed" && (
                    <button
                      className="subtle-button"
                      onClick={() => void verdict("unreviewed")}
                    >
                      Undo
                    </button>
                  )}
                </div>
                <small className="evidence-disclaimer">
                  {current.evidenceType === "speech"
                    ? "Model-assisted transcript. Listen to verify the wording."
                    : "Actual source frame. The finding is a model-assisted interpretation."}{" "}
                  Times are approximate.
                </small>
              </section>
            )}
            {review && (
              <details className="review-details">
                <summary>
                  What was checked <ChevronDown size={14} />
                </summary>
                <div>
                  {review.passes.map((p) => (
                    <p key={p.name}>
                      {p.status === "complete" ? "✓" : "!"} {p.name} ·{" "}
                      {p.status}
                      {p.ms ? ` · ${(p.ms / 1000).toFixed(1)}s` : ""}
                    </p>
                  ))}
                  {review.checks.map((c) => (
                    <p key={c.requirementId}>
                      {c.requirementId} ·{" "}
                      {c.status === "pass"
                        ? "Supported in checked material"
                        : c.status === "suspected_failure"
                          ? "Needs review"
                          : "Could not verify"}{" "}
                      — {c.detail}
                    </p>
                  ))}
                  <ul>
                    {review.limitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                  <small>
                    {review.model} ·{" "}
                    {review.analysisMs > 0
                      ? `${(review.analysisMs / 1000).toFixed(1)}s ${review.model === "Local picture and audio checks" ? "local scan" : "server analysis"}`
                      : "Original inference latency not benchmarked"}{" "}
                    ·{" "}
                    {review.endToEndMs
                      ? `${(review.endToEndMs / 1000).toFixed(1)}s end-to-end · `
                      : ""}
                    {replay ? "Saved replay" : "Live review"}
                    {generationMs
                      ? ` · ${(generationMs / 1000).toFixed(0)}s measured generation`
                      : ""}
                  </small>
                </div>
              </details>
            )}
          </section>
          <aside className="campaign-column">
            {!review || tab === "brief" ? (
              <section className="campaign-panel">
                <div className="campaign-panel-head">
                  <div>
                    <span className="step-number">02</span>
                    <strong>The campaign brief</strong>
                  </div>
                  {review && (
                    <button
                      className="subtle-button"
                      onClick={() => setTab("findings")}
                    >
                      Back to review <ArrowRight size={13} />
                    </button>
                  )}
                </div>
                <h2>What should this ad do?</h2>
                <p>
                  Paste the same brief you gave your video generator. We’ll
                  check the draft against it.
                </p>
                <textarea
                  aria-label="Campaign brief"
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  disabled={busy}
                  rows={9}
                  placeholder="Who’s it for? What’s the message? What needs to stay right?"
                />
                <div className="brief-helper">
                  <button
                    onClick={() => {
                      setBrief(DEMO_BRIEF);
                      setScript("");
                      setMode("meaning");
                      setNotice("Mercor campaign brief loaded.");
                    }}
                  >
                    <Sparkles size={12} /> Use the Mercor campaign
                  </button>
                  <span>{brief.trim().length} characters</span>
                </div>
                <details className="optional-settings">
                  <summary>
                    Have a script or brand references? <Plus size={14} />
                  </summary>
                  <label>
                    Approved script <span>Optional</span>
                    <textarea
                      aria-label="Approved script"
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      rows={4}
                      disabled={busy}
                      placeholder="Add a script only if the wording needs checking."
                    />
                  </label>
                  <select
                    aria-label="Script matching"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    disabled={busy}
                  >
                    <option value="meaning">Allow natural paraphrases</option>
                    <option value="exact">Match the script exactly</option>
                  </select>
                  <label className="creator-reference">
                    <ImageIcon size={16} />
                    <span>
                      Add logo or product photos
                      <small>Up to 2 images · 2 MB each</small>
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      disabled={busy}
                      onChange={(e) => {
                        const fs = Array.from(e.target.files ?? []);
                        if (
                          fs.length > 2 ||
                          fs.some((f) => f.size > 2 * 1024 * 1024)
                        ) {
                          setError("Choose up to 2 images under 2 MB each.");
                          return;
                        }
                        setRefs(fs);
                        setRefsChanged(true);
                      }}
                    />
                  </label>
                  {refs.map((f) => (
                    <div className="reference-chip" key={f.name}>
                      {f.name}
                      <button
                        onClick={() => {
                          setRefs(refs.filter((x) => x !== f));
                          setRefsChanged(true);
                        }}
                        aria-label={`Remove ${f.name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </details>
                <div className="review-action">
                  <button
                    className="cta purple"
                    disabled={!project || !brief.trim() || busy || uploading}
                    onClick={() => void run(!!review)}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <ScanLine size={17} />
                    )}{" "}
                    {busy
                      ? "Reviewing your draft…"
                      : connected
                        ? "Review this draft"
                        : "Check picture & audio"}
                    {!busy && <ArrowRight size={16} />}
                  </button>
                  <small>
                    {busy ? (
                      <>
                        {phase} · {(elapsed / 1000).toFixed(0)}s{" "}
                        <button onClick={() => cancel.current?.abort()}>
                          Cancel
                        </button>
                      </>
                    ) : !project ? (
                      "Add your video to start."
                    ) : connected ? (
                      "Message, captions, brand details. One review."
                    ) : (
                      "Picture and audio stay local. Connect AI review to check the campaign brief."
                    )}
                  </small>
                </div>
              </section>
            ) : (
              <section className="results-panel">
                <div className="results-header">
                  <div>
                    <span className="step-number">03</span>
                    <strong>The second opinion</strong>
                  </div>
                  <span className="review-source">
                    {replay
                      ? "Saved replay"
                      : review.model === "Local picture and audio checks"
                        ? "Playback checked"
                        : "Review complete"}
                  </span>
                </div>
                <div className="results-summary">
                  <h2>
                    {review.findings.length
                      ? `${review.findings.length} moments to look at.`
                      : "No supported issues to flag."}
                  </h2>
                  {review.model === "Local picture and audio checks" && (
                    <p className="coverage-notice">
                      Picture and audio only. Spoken content and the campaign
                      brief have not been reviewed.{" "}
                      <button onClick={() => setModal("settings")}>
                        Connect AI review
                      </button>
                    </p>
                  )}
                  <p>
                    {review.findings.length
                      ? "A few details worth your attention. You decide what makes the next cut."
                      : "No issues were flagged. Check coverage before treating the draft as ready."}
                  </p>
                  <div>
                    <span>
                      {
                        review.findings.filter(
                          (f) =>
                            f.category !== "creative" &&
                            f.requirementId !== "MEDIA",
                        ).length
                      }{" "}
                      brief checks flagged
                    </span>
                    {!!review.mediaScan && (
                      <span>
                        {
                          review.findings.filter(
                            (f) => f.requirementId === "MEDIA",
                          ).length
                        }{" "}
                        playback notes
                      </span>
                    )}
                    <span>
                      {
                        review.findings.filter((f) => f.category === "creative")
                          .length
                      }{" "}
                      creative notes
                    </span>
                  </div>
                </div>
                <div className="results-filter">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => setFilter("all")}
                  >
                    All
                  </button>
                  <button
                    className={filter === "fixes" ? "active" : ""}
                    onClick={() => setFilter("fixes")}
                  >
                    Brief issues
                  </button>
                  {!!review.mediaScan && (
                    <button
                      className={filter === "playback" ? "active" : ""}
                      onClick={() => setFilter("playback")}
                    >
                      Playback
                    </button>
                  )}
                  <button
                    className={filter === "creative" ? "active" : ""}
                    onClick={() => setFilter("creative")}
                  >
                    Creative notes
                  </button>
                </div>
                <div className="creator-findings">
                  {visible.length ? (
                    visible.map((f, i) => (
                      <button
                        key={f.id}
                        className={`creator-finding ${selected === f.id ? "selected" : ""} ${f.reviewStatus === "dismissed" ? "dismissed" : ""}`}
                        onClick={() => select(f)}
                      >
                        <div>
                          <span
                            className={`finding-type ${f.category === "creative" ? "creative" : ""}`}
                          >
                            {f.category === "creative" ? (
                              <Sparkles size={11} />
                            ) : (
                              <Flag size={11} />
                            )}{" "}
                            {f.category === "creative"
                              ? "Creative suggestion"
                              : f.requirementId === "MEDIA"
                                ? "Playback check"
                                : CATEGORY_LABELS[f.category]}
                          </span>
                          <span className="timestamp-pill">
                            {formatTime(f.start)} <Play size={9} />
                          </span>
                        </div>
                        <h3>{f.title}</h3>
                        <p>{f.observed}</p>
                        <footer>
                          {f.reviewStatus === "confirmed" ? (
                            <span className="confirmed-mark">
                              <Check size={12} /> Added to changes
                            </span>
                          ) : f.reviewStatus === "dismissed" ? (
                            <span>Dismissed</span>
                          ) : (
                            <span>View the evidence</span>
                          )}
                          <ArrowRight size={14} />
                        </footer>
                      </button>
                    ))
                  ) : (
                    <div className="no-findings">
                      <CheckCheck size={25} />
                      <p>No findings in this view.</p>
                    </div>
                  )}
                </div>
                <div className="results-actions">
                  <button
                    className="cta dark"
                    onClick={() => setModal("export")}
                  >
                    <ArrowDownToLine size={15} /> Get the next-take brief{" "}
                    <span>{confirmed}</span>
                  </button>
                  <div>
                    <button onClick={() => setTab("brief")}>
                      Edit campaign brief
                    </button>
                    <button disabled={busy} onClick={() => void run(true)}>
                      {busy ? "Reviewing…" : "Run again"}
                    </button>
                  </div>
                </div>
              </section>
            )}
            {busy && (
              <div className="creator-progress" role="status">
                <LoaderCircle size={18} className="spin" />
                <div>
                  <strong>Giving your draft a closer look.</strong>
                  <p>
                    {(elapsed / 1000).toFixed(0)} seconds elapsed. Findings will
                    appear when the review is ready.
                  </p>
                </div>
              </div>
            )}
            {!review && (
              <div className="taste-note">
                <span>
                  <ShieldCheck size={17} /> Your taste stays in the loop.
                </span>
                <p>
                  Clear mistakes get evidence. Creative notes get a second
                  opinion. No made-up “viral score.”
                </p>
              </div>
            )}
            {review && (
              <details className="creator-transcript">
                <summary>
                  Read the transcript <AudioLines size={15} />
                </summary>
                {review.transcript.length ? (
                  review.transcript.map((s, i) => (
                    <button
                      key={i}
                      className={
                        time >= s.start && time <= s.end ? "active" : ""
                      }
                      onClick={() => seek(s.start)}
                    >
                      <span>{formatTime(s.start)}</span>
                      <p>{s.text}</p>
                    </button>
                  ))
                ) : (
                  <p>
                    No transcript was returned. See review coverage for details.
                  </p>
                )}
              </details>
            )}
          </aside>
        </div>
        <footer className="creator-footer">
          <span>Make more. Second-guess less.</span>
          <span>
            Video stays in this browser until you run a review.{" "}
            <button onClick={() => setModal("settings")}>AI settings</button>
          </span>
        </footer>
      </main>
      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) void pick(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {notice && (
        <div className="creator-toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      {modal && (
        <div className="creator-overlay" onClick={() => setModal(null)}>
          <section
            className={`creator-dialog ${modal === "demo" ? "campaign-dialog" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "settings"
                ? "AI connection"
                : modal === "demo"
                  ? "Mercor campaign"
                  : modal === "new"
                    ? "My drafts"
                    : "Export next-take brief"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close"
              onClick={() => setModal(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
            {modal === "demo" ? (
              <>
                <div className="creator-eyebrow">
                  <Sparkles size={13} /> CAMPAIGN STARTER
                </div>
                <h2>Brief it like a marketer.</h2>
                <p>
                  A normal Mercor campaign request. No planted mistakes.
                  Generate the ad, then review whatever comes back.
                </p>
                <div className="campaign-prompt">{GENERATION_PROMPT}</div>
                <div className="dialog-actions">
                  <button
                    className="cta purple"
                    onClick={() => void copy(GENERATION_PROMPT)}
                  >
                    <Clipboard size={15} /> Copy creative brief
                  </button>
                  <a
                    className="cta outline"
                    href="https://app.heygen.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open HeyGen <ArrowRight size={15} />
                  </a>
                </div>
                <button
                  className="use-campaign-button"
                  onClick={() => {
                    setBrief(DEMO_BRIEF);
                    setScript("");
                    setMode("meaning");
                    setTab("brief");
                    setModal(null);
                    setNotice(
                      "Campaign brief loaded. Add the generated draft when it’s ready.",
                    );
                  }}
                >
                  Use this campaign in the reviewer <ArrowRight size={15} />
                </button>
                <details className="generation-timing">
                  <summary>
                    Time the video generation <Clock3 size={14} />
                  </summary>
                  <p>
                    Start when you submit the job; stop when the video is ready.
                    We’ll keep the measured time separate from review time.
                  </p>
                  {generationStart ? (
                    <div>
                      <strong>
                        {formatTime(generationElapsed / 1000)} elapsed
                      </strong>
                      <button
                        className="cta outline small"
                        onClick={() => {
                          const ms = Date.now() - generationStart;
                          setGenerationMs(ms);
                          setGenerationStart(null);
                          if (project)
                            void persist({ ...project, generationMs: ms });
                        }}
                      >
                        Video is ready
                      </button>
                    </div>
                  ) : (
                    <button
                      className="cta outline small"
                      onClick={() => {
                        setGenerationStart(Date.now());
                        setGenerationElapsed(0);
                      }}
                    >
                      Start timer
                    </button>
                  )}
                  {generationMs && (
                    <small>
                      Last measured run: {(generationMs / 1000).toFixed(0)}{" "}
                      seconds
                    </small>
                  )}
                </details>
                <p className="dialog-footnote">
                  Independent hackathon campaign concept. Not an official Mercor
                  ad. If it meets the brief, the reviewer should say so.
                </p>
              </>
            ) : modal === "settings" ? (
              <>
                <div className="creator-eyebrow">
                  ONE-TIME SETUP FOR THIS TAB
                </div>
                <h2>
                  {connected ? "Your review engine." : "Connect AI review."}
                </h2>
                <p>
                  Your video and campaign brief are sent through this app to
                  Gemini when you run a review. Your key stays in this tab’s
                  memory.
                </p>
                <label className="dialog-label" htmlFor="api-key">
                  Gemini API key
                </label>
                <input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setConnected(false);
                  }}
                  placeholder="Paste your API key"
                />
                <button
                  className="cta purple full"
                  onClick={() => void connect()}
                  disabled={!key || connecting}
                >
                  {connecting ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Zap size={16} />
                  )}{" "}
                  {connecting
                    ? "Checking access…"
                    : connected
                      ? "Reconnect"
                      : "Connect"}
                </button>
                {connected && (
                  <>
                    <details className="model-settings" open={!!error}>
                      <summary>
                        Model settings <ChevronDown size={14} />
                      </summary>
                      <select
                        aria-label="Review model"
                        value={model}
                        onChange={(e) => {
                          setModel(e.target.value);
                          setError("");
                        }}
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <div className="model-shortcuts">
                        {models
                          .filter((m) =>
                            /^gemini-[0-9.]+-flash(-lite)?$/.test(m.id),
                          )
                          .sort((a, b) =>
                            b.id.localeCompare(a.id, undefined, {
                              numeric: true,
                            }),
                          )
                          .slice(0, 8)
                          .map((m) => (
                            <button
                              key={m.id}
                              className={m.id === model ? "active" : ""}
                              onClick={() => {
                                setModel(m.id);
                                setError("");
                              }}
                            >
                              {m.name}
                            </button>
                          ))}
                      </div>
                      <small>
                        Model access and free quota depend on your Google
                        account.
                      </small>
                    </details>
                    <button
                      className="cta dark full"
                      onClick={() => setModal(null)}
                    >
                      Back to my draft <ArrowRight size={15} />
                    </button>
                  </>
                )}
                <div className="connection-links">
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get a Gemini key <ArrowRight size={12} />
                  </a>
                  {connected && (
                    <button
                      onClick={() => {
                        setKey("");
                        setConnected(false);
                        setModels([]);
                      }}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
                {error && <p className="dialog-error">{error}</p>}
                <details className="diagnostic-settings">
                  <summary>Developer diagnostic</summary>
                  <p>
                    Talking-head controls test actual picture and audio locally.
                    The stress copy has known edits for testing; it is not the
                    primary campaign demo. Sample footage: HeyGen's public
                    avatar showcase.
                  </p>
                  <button
                    className="subtle-button"
                    onClick={() => void loadTalkingHead(false)}
                  >
                    Load talking-head clean control
                  </button>
                  <button
                    className="subtle-button"
                    onClick={() => void loadTalkingHead(true)}
                  >
                    Load talking-head stress test
                  </button>
                  <details>
                    <summary>Text-only regression tests</summary>
                    <button
                      className="subtle-button"
                      onClick={() => void loadFixture()}
                    >
                      Load 8-second visual fixture
                    </button>
                    <button
                      className="cta outline small"
                      onClick={() => void loadInternalReplay()}
                      disabled={busy}
                    >
                      Open internal-agent test replay
                    </button>
                  </details>
                </details>
              </>
            ) : modal === "new" ? (
              <>
                <div className="creator-eyebrow">SAVED IN THIS BROWSER</div>
                <h2>Your drafts.</h2>
                <p>
                  Pick up where you left off. Saved reviews open as replays.
                </p>
                <button
                  className="cta purple full"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                >
                  <Plus size={16} /> Add another video
                </button>
                <div className="saved-drafts">
                  {projects.length ? (
                    projects.map((p) => (
                      <div key={p.id}>
                        <button
                          onClick={() => {
                            openProject(p);
                            setModal(null);
                          }}
                          disabled={busy}
                        >
                          <Film size={19} />
                          <span>
                            <strong>{p.name}</strong>
                            <small>
                              {formatTime(p.duration)} ·{" "}
                              {p.review
                                ? `${p.review.findings.length} findings · Saved review`
                                : "Not reviewed yet"}
                            </small>
                          </span>
                          <ArrowRight size={15} />
                        </button>
                        <button
                          className="draft-delete"
                          aria-label={`Delete ${p.name}`}
                          onClick={() => void remove(p)}
                          disabled={busy}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>
                      No saved drafts yet. Add your first video to get started.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="creator-eyebrow">FOR THE NEXT TAKE</div>
                <h2>Less feedback ping-pong.</h2>
                <p>
                  {confirmed} confirmed {confirmed === 1 ? "change" : "changes"}
                  . One brief to send to your editor or paste into your
                  generator.
                </p>
                <div className="export-preview">
                  {review ? correctionBrief(review) : "No review selected."}
                </div>
                <div className="dialog-actions">
                  <button
                    className="cta purple"
                    onClick={() => {
                      if (review) void copy(correctionBrief(review));
                    }}
                  >
                    <Clipboard size={15} /> Copy brief
                  </button>
                  <button
                    className="cta outline"
                    onClick={() => {
                      if (review)
                        download(
                          "takecheck-next-take.md",
                          correctionBrief(review),
                        );
                    }}
                  >
                    <ArrowDownToLine size={15} /> Download
                  </button>
                </div>
                <button
                  className="subtle-button review-data-export"
                  onClick={() => {
                    if (review)
                      download(
                        "takecheck-review.json",
                        JSON.stringify(review, null, 2),
                      );
                  }}
                >
                  Export full review data
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
