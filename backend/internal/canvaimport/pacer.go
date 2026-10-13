package canvaimport

import (
	"context"
	"time"
)

// pacer spaces export starts: at most max in any window. 14 a minute keeps a
// run under Canva's 75 exports per 5 minutes and per user. now and sleep are
// injectable for tests.
type pacer struct {
	max    int
	window time.Duration
	starts []time.Time
	now    func() time.Time
	sleep  func(ctx context.Context, d time.Duration) error
}

func newPacer(max int, window time.Duration, now func() time.Time, sleep func(context.Context, time.Duration) error) *pacer {
	return &pacer{max: max, window: window, now: now, sleep: sleep}
}

// release gives back the start wait last recorded, for a design that turned
// out to need no export.
func (p *pacer) release() {
	if n := len(p.starts); n > 0 {
		p.starts = p.starts[:n-1]
	}
}

// wait returns once a start is allowed (or ctx ends), and records the start.
func (p *pacer) wait(ctx context.Context) error {
	for {
		t := p.now()
		kept := p.starts[:0]
		for _, s := range p.starts {
			if t.Sub(s) < p.window {
				kept = append(kept, s)
			}
		}
		p.starts = kept
		if len(p.starts) < p.max {
			break
		}
		d := p.window - t.Sub(p.starts[0])
		if d < 250*time.Millisecond {
			d = 250 * time.Millisecond
		}
		if err := p.sleep(ctx, d); err != nil {
			return err
		}
	}
	p.starts = append(p.starts, p.now())
	return nil
}
