import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {mergeTokens, type MotionSpec, type Overlay, type Shot} from './tokens';
import {MusicLane, CameraStage, Captions, Idle, LayerView, OverlayView, PlaceholderCard, SceneImage, SfxTrack} from './components';

// ---------------------------------------------------------------------------
// The Video composition: renders one motion.json (passed as inputProps).
// Shots sharing a `stage` id render inside ONE camera arc — the held-set
// grammar: delta frames read as events on a stable stage, not camera restarts.
// ---------------------------------------------------------------------------

type StageGroup = {
  key: string;
  shots: Shot[];
  startF: number;
  durF: number;
};

const groupStages = (shots: Shot[], fps: number): StageGroup[] => {
  const groups: StageGroup[] = [];
  for (const shot of shots) {
    const prev = groups[groups.length - 1];
    const sameStage = prev && shot.stage && prev.shots[0].stage === shot.stage;
    if (sameStage) {
      prev.shots.push(shot);
    } else {
      groups.push({key: `${shot.stage ?? 'solo'}-${shot.id}`, shots: [shot], startF: 0, durF: 0});
    }
  }
  for (const g of groups) {
    const start = g.shots[0].start_s;
    const end = g.shots[g.shots.length - 1].start_s + g.shots[g.shots.length - 1].duration_s;
    g.startF = Math.round(start * fps);
    g.durF = Math.max(1, Math.round(end * fps) - g.startF);
  }
  return groups;
};

const overlayStartS = (o: Overlay): number =>
  o.type === 'progressive-reveal' ? Math.min(...o.items.map((it) => it.at_s)) : o.at_s;

// Rebase a progressive-reveal's item times onto its own mount time.
const rebased = (o: Overlay, startS: number): Overlay =>
  o.type === 'progressive-reveal'
    ? {...o, items: o.items.map((it) => ({...it, at_s: it.at_s - startS}))}
    : o;

export const Video: React.FC<{spec: MotionSpec}> = ({spec}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const tokens = useMemo(() => mergeTokens(spec.tokens), [spec.tokens]);
  const isShort = spec.captions.style === 'short';
  const stages = useMemo(() => groupStages(spec.shots, fps), [spec.shots, fps]);

  return (
    <AbsoluteFill style={{backgroundColor: tokens.palette.bg_default}}>
      {/* Scene layer: one Sequence per STAGE, one camera arc inside. */}
      {stages.map((g) => {
        const base = g.shots[0];
        return (
          <Sequence key={g.key} from={g.startF} durationInFrames={g.durF}>
            <CameraStage
              tokens={tokens}
              camera={base.camera}
              entrance={base.entrance}
              stageDurationInFrames={g.durF}
            >
              {g.shots.map((shot) => {
                const fromF = Math.round(shot.start_s * fps) - g.startF;
                const durF = Math.max(1, Math.round((shot.start_s + shot.duration_s) * fps) - Math.round(shot.start_s * fps));
                return (
                  <Sequence key={shot.id} from={fromF} durationInFrames={durF}>
                    {shot.layers && shot.layers.length ? (
                      shot.baseline_life === true ? (
                        <Idle tokens={tokens}>
                          <AbsoluteFill>
                            {shot.plate ? <SceneImage tokens={tokens} src={shot.plate} /> : null}
                            {shot.layers.map((ly) => (
                              <LayerView key={ly.id} layer={ly} tokens={tokens} />
                            ))}
                          </AbsoluteFill>
                        </Idle>
                      ) : (
                        <AbsoluteFill>
                          {shot.plate ? <SceneImage tokens={tokens} src={shot.plate} /> : null}
                          {shot.layers.map((ly) => (
                            <LayerView key={ly.id} layer={ly} tokens={tokens} />
                          ))}
                        </AbsoluteFill>
                      )
                    ) : shot.image ? (
                      shot.idle === 'bob' ? (
                        <Idle tokens={tokens}>
                          <SceneImage tokens={tokens} src={shot.image} />
                        </Idle>
                      ) : (
                        <SceneImage tokens={tokens} src={shot.image} />
                      )
                    ) : (
                      <PlaceholderCard
                        tokens={tokens}
                        kind={shot.placeholder?.kind ?? 'missing'}
                        label={shot.placeholder?.label ?? shot.id}
                      />
                    )}
                  </Sequence>
                );
              })}
            </CameraStage>
          </Sequence>
        );
      })}

      {/* Overlay layer: screen-space (never inherits the camera transform). */}
      {spec.shots.flatMap((shot) => {
        const shotEndF = Math.round((shot.start_s + shot.duration_s) * fps);
        return shot.overlays.map((o, i) => {
          const startS = overlayStartS(o);
          const fromF = Math.round(startS * fps);
          // A chapter-card with its own dur_s (cards 1-N) shows for that fixed window; every other overlay
          // (and the end card, which has no dur_s) runs to the shot's end — the end card's shot is
          // post-VO-extended so it holds past the last word (P03).
          const durF =
            o.type === 'chapter-card' && o.dur_s != null
              ? Math.max(1, Math.round(o.dur_s * fps))
              : Math.max(1, shotEndF - fromF);
          return (
            <Sequence key={`${shot.id}-ov${i}`} from={fromF} durationInFrames={durF}>
              {/* [A2] stackIndex = order within this shot's overlays → collision offset. */}
              <OverlayView tokens={tokens} overlay={rebased(o, startS)} fps={fps} isShort={isShort} stackIndex={i} />
            </Sequence>
          );
        });
      })}

      {/* Captions + VO — movie-level. */}
      {spec.captions.enabled ? (
        <Captions tokens={tokens} words={spec.captions.words} style={spec.captions.style} />
      ) : null}
      {spec.audio ? <Audio src={staticFile(spec.audio)} /> : null}
      {spec.audioSpec ? (
        <>
          <MusicLane audio={spec.audioSpec} />
          <SfxTrack audio={spec.audioSpec} />
        </>
      ) : null}
    </AbsoluteFill>
  );
};

// A tiny self-contained default so the composition registers without inputs.
export const DEMO_SPEC: MotionSpec = {
  schema: 'faceless-youtube/motion@1',
  piece: 'demo',
  video_slug: 'demo',
  fps: 30,
  width: 1920,
  height: 1080,
  audio: null,
  audio_seconds: null,
  captions: {enabled: false, style: 'long-form', words: []},
  shots: [
    {
      id: 'D01',
      start_s: 0,
      duration_s: 2,
      image: null,
      placeholder: {kind: 'demo', label: 'render-engine OK'},
      camera: {move: 'push-in', pan: null, intensity: 1},
      entrance: 'cut',
      idle: 'none',
      overlays: [],
    },
  ],
};
