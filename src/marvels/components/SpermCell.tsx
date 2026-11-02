/** The wave at rest, and the same wave with its control points inverted. */
const TAIL_NEUTRAL = "M48 27 C 38 18, 30 36, 20 27 C 10 18, 4 36, -4 27";
const TAIL_FLIPPED = "M48 27 C 38 36, 30 18, 20 27 C 10 36, 4 18, -4 27";

interface SpermCellProps {
  bodyColor: string; // hsl values
  tailColor: string;
  swimming?: boolean;
  size?: number;
}

export const SpermCell = ({
  bodyColor,
  tailColor,
  swimming = true,
  size = 44,
}: SpermCellProps) => {
  return (
    <svg
      width={size}
      height={size * 0.55}
      viewBox="0 0 100 55"
      fill="none"
      style={{ filter: `drop-shadow(0 0 6px hsl(${bodyColor} / 0.7))` }}
    >
      {/* Tail */}
      {/*
        The wave is animated by SMIL rather than by framer-motion, and that is
        the whole point of this comment.

        The tail used to be a `motion.path` with `animate={{ d: [...] }}`.
        Framer Motion has no interpolator for the `d` attribute — it is a path
        grammar, not a number or a colour — so on the frames before it gave up
        it wrote the string "undefined" into the attribute. Chrome rejected
        each one with

          <path> attribute d: Expected moveto path command ('M' or 'm'),
          "undefined".

        six times on mount, one per racer, and `/marvels` was the only route in
        the whole app that failed `npm run smoke`. The tail still waved
        afterwards, which is why it survived: the errors were transient and the
        end state was correct, so nothing looked wrong unless you had the
        console open.

        SVG's own `<animate>` interpolates `d` natively, provided every
        keyframe has the same command structure — these three do, differing
        only in the control points that flip the wave. So the animation is the
        one the author wanted, done by the engine that can actually do it.
      */}
      <path
        d={TAIL_NEUTRAL}
        stroke={`hsl(${tailColor})`}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      >
        {swimming && (
          <animate
            attributeName="d"
            dur="0.45s"
            repeatCount="indefinite"
            calcMode="spline"
            keyTimes="0; 0.5; 1"
            keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"
            values={`${TAIL_NEUTRAL}; ${TAIL_FLIPPED}; ${TAIL_NEUTRAL}`}
          />
        )}
      </path>
      {/* Head */}
      <ellipse cx="68" cy="27" rx="26" ry="20" fill={`hsl(${bodyColor})`} />
      <ellipse cx="68" cy="27" rx="26" ry="20" fill="url(#sheen)" opacity="0.5" />
      {/* nucleus */}
      <circle cx="74" cy="27" r="8" fill={`hsl(${tailColor})`} opacity="0.85" />
      <defs>
        <radialGradient id="sheen" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0%" stopColor="white" stopOpacity="0.9" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
};
