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
    durationInFrames: Math.max(1, Math.ceil(totalS * s.fps) + 6),
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
