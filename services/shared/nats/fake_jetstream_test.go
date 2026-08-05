package nats

import "github.com/nats-io/nats.go"

// fakeJetStream records the stream and consumer configuration that the Ensure
// helpers send to the server. The embedded interface leaves every unused
// JetStream method nil, so a helper that starts calling one fails loudly here
// instead of passing silently.
type fakeJetStream struct {
	nats.JetStreamContext

	existing         *nats.StreamInfo
	existingConsumer *nats.ConsumerInfo

	added           *nats.StreamConfig
	updated         *nats.StreamConfig
	addedConsumer   *nats.ConsumerConfig
	consumerStreams []string
}

func (f *fakeJetStream) StreamInfo(_ string, _ ...nats.JSOpt) (*nats.StreamInfo, error) {
	if f.existing == nil {
		return nil, nats.ErrStreamNotFound
	}
	return f.existing, nil
}

func (f *fakeJetStream) AddStream(cfg *nats.StreamConfig, _ ...nats.JSOpt) (*nats.StreamInfo, error) {
	stored := *cfg
	f.added = &stored
	f.existing = &nats.StreamInfo{Config: stored}
	return f.existing, nil
}

func (f *fakeJetStream) UpdateStream(cfg *nats.StreamConfig, _ ...nats.JSOpt) (*nats.StreamInfo, error) {
	stored := *cfg
	f.updated = &stored
	f.existing = &nats.StreamInfo{Config: stored}
	return f.existing, nil
}

func (f *fakeJetStream) ConsumerInfo(_, _ string, _ ...nats.JSOpt) (*nats.ConsumerInfo, error) {
	if f.existingConsumer == nil {
		return nil, nats.ErrConsumerNotFound
	}
	return f.existingConsumer, nil
}

func (f *fakeJetStream) AddConsumer(stream string, cfg *nats.ConsumerConfig, _ ...nats.JSOpt) (*nats.ConsumerInfo, error) {
	stored := *cfg
	f.addedConsumer = &stored
	f.consumerStreams = append(f.consumerStreams, stream)
	f.existingConsumer = &nats.ConsumerInfo{Stream: stream, Name: cfg.Durable, Config: stored}
	return f.existingConsumer, nil
}
