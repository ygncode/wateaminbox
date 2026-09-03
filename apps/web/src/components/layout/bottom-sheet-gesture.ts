const MIN_FLICK_DISTANCE_PX = 24;
const FLICK_VELOCITY_PX_PER_MS = 0.55;
const MIN_DISTANCE_THRESHOLD_PX = 96;
const MAX_DISTANCE_THRESHOLD_PX = 160;
const DISTANCE_THRESHOLD_RATIO = 0.22;

/** Decide whether a downward grabber drag should dismiss a bottom sheet. */
export function shouldDismissBottomSheet({
  offsetY,
  velocityY,
  panelHeight,
}: {
  offsetY: number;
  velocityY: number;
  panelHeight: number;
}): boolean {
  const distanceThreshold = Math.min(
    MAX_DISTANCE_THRESHOLD_PX,
    Math.max(MIN_DISTANCE_THRESHOLD_PX, panelHeight * DISTANCE_THRESHOLD_RATIO),
  );

  return (
    offsetY >= distanceThreshold ||
    (offsetY >= MIN_FLICK_DISTANCE_PX && velocityY >= FLICK_VELOCITY_PX_PER_MS)
  );
}
