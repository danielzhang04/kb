import {CalculateMetadataFunction, Composition} from 'remotion';
import {DEMO_SPEC, Video} from './Video';
import type {MotionSpec} from './tokens';
import {loadEngineFont} from './font';

// [S4] Kick off the locked-font load as soon as the bundle evaluates; the
// delayRender inside gates every frame until "Ink Free" is actually resolved.
loadEngineFont();

const FPS = 30;

// Duration/dimensions come from the motion.json passed as inputProps.
const calculateVideoMetadata: CalculateMetadataFunction<{spec: MotionSpec}> = ({props}) => {
  const s = props.spec;
  const last = s.shots[s.shots.length - 1];
  const totalS = Math.max(s.audio_seconds ?? 0, last ? last.start_s + last.duration_s : 1);
  return {
    fps: s.fps,
    width: s.width,
    height: s.height,
    // [Q34 2026-07-17] End EXACTLY on the last shot's Sequence end frame. Round (not ceil) matches the
    // per-shot Sequence end in Video.tsx (round(end*fps)); the former `ceil(...) + 6` left ~7 uncovered
    // trailing frames that rendered the root bg_default (#dfdcd5, near-white) = the end-of-video white
    // flash. totalS already includes the +4s post-VO hold (inside the last shot) and dominates
    // audio_seconds here, so dropping the pad clips no content or audio.
    durationInFrames: Math.max(1, Math.round(totalS * s.fps)),
  };
};

export const RemotionRoot: React.FC = () => {
  // Video is the single production composition (layered shots render via LayerView).
  return (
    <Composition
      id="Video"
      component={Video}
      defaultProps={{spec: DEMO_SPEC}}
      calculateMetadata={calculateVideoMetadata}
      durationInFrames={60}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
