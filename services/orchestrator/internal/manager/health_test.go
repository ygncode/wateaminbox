package manager

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyRestartJitter_StaysWithinWindow(t *testing.T) {
	const backoff = 5 * time.Second
	spread := time.Duration(float64(backoff) * restartJitterFraction)

	for i := 0; i < 1000; i++ {
		got := applyRestartJitter(backoff)
		assert.Greater(t, got, backoff-spread, "jittered backoff below window")
		assert.LessOrEqual(t, got, backoff, "jittered backoff exceeded the nominal backoff")
	}
}

// jitterSamples is large enough that the distribution assertions below fail
// only on a genuine regression. With 10+ buckets and 2000 samples the chance of
// any bucket coming up empty, or of one holding twice its share, is below
// 1e-40; math/rand/v2's global source cannot be seeded, so the tests rely on
// that margin instead of a fixed seed.
const jitterSamples = 2000

// jitterHistogram counts sampled delays into fixed-width buckets measured down
// from the nominal backoff: bucket 0 is the slice of the window closest to
// backoff. Buckets, rather than distinct nanosecond values, are what matters
// operationally — two workers 3ns apart still reconnect together.
func jitterHistogram(t *testing.T, backoff, bucket time.Duration) []int {
	t.Helper()

	spread := time.Duration(float64(backoff) * restartJitterFraction)
	require.Zero(t, spread%bucket, "bucket width must divide the jitter spread evenly")

	buckets := make([]int, spread/bucket)
	for i := 0; i < jitterSamples; i++ {
		got := applyRestartJitter(backoff)
		require.Greater(t, got, backoff-spread, "jittered backoff below window")
		require.LessOrEqual(t, got, backoff, "jittered backoff exceeded the nominal backoff")
		buckets[(backoff-got)/bucket]++
	}
	return buckets
}

// assertSpread fails if any bucket is empty (the window is not being used) or
// if one bucket holds more than twice its fair share (delays are clumping).
func assertSpread(t *testing.T, buckets []int, bucket time.Duration) {
	t.Helper()

	fairShare := jitterSamples / len(buckets)
	for i, count := range buckets {
		assert.NotZero(t, count,
			"no restart landed in the %v bucket at offset %v; the jitter window is not fully used",
			bucket, time.Duration(i)*bucket)
		assert.Less(t, count, 2*fairShare,
			"%d of %d restarts landed in a single %v bucket at offset %v; they would reconnect together",
			count, jitterSamples, bucket, time.Duration(i)*bucket)
	}
}

// TestApplyRestartJitter_SpreadsAcrossBackoffWindow is the point of the jitter:
// workers recovered together share a RestartCount and would otherwise compute
// an identical delay, reconnecting to WhatsApp in one synchronized burst. At
// the 5s first-attempt backoff the delays must fill the whole 2.5s window in
// 250ms slices, not merely differ by nanoseconds.
func TestApplyRestartJitter_SpreadsAcrossBackoffWindow(t *testing.T) {
	const (
		backoff = 5 * time.Second
		bucket  = 250 * time.Millisecond
	)

	assertSpread(t, jitterHistogram(t, backoff, bucket), bucket)
}

// TestApplyRestartJitter_CeilingSpreadsAcrossMinute covers the case that
// matters most: after repeated failures every worker sits at maxRestartBackoff,
// so the ceiling is where synchronization would be worst. The delays must
// spread over the full minute in 5s slices. This also guards the regression a
// symmetric jitter window would cause, where clamping out-of-range values back
// to the ceiling would pile workers into the bucket at offset 0.
func TestApplyRestartJitter_CeilingSpreadsAcrossMinute(t *testing.T) {
	const bucket = 5 * time.Second

	assertSpread(t, jitterHistogram(t, maxRestartBackoff, bucket), bucket)
}

// TestApplyRestartJitter_DegenerateBackoffs guards the cases where the spread
// rounds to nothing: the delay must be returned unchanged rather than panicking
// in rand.Int64N or going negative.
func TestApplyRestartJitter_DegenerateBackoffs(t *testing.T) {
	for _, backoff := range []time.Duration{0, time.Nanosecond, time.Duration(-1)} {
		t.Run(backoff.String(), func(t *testing.T) {
			assert.Equal(t, backoff, applyRestartJitter(backoff))
		})
	}
}
