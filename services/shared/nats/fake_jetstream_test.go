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

	// existingConsumers/addedConsumers key by durable name, for tests that
	// exercise more than one consumer at once (e.g. EnsureEventsStream now
	// registering three durables). ConsumerInfo/AddConsumer consult these
	// first and fall back to the singular fields above so every existing
	// single-consumer test keeps working unmodified.
	existingConsumers map[string]*nats.ConsumerInfo
	addedConsumers    map[string]*nats.ConsumerConfig
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

func (f *fakeJetStream) ConsumerInfo(_ string, name string, _ ...nats.JSOpt) (*nats.ConsumerInfo, error) {
	if f.existingConsumers != nil {
		if info, ok := f.existingConsumers[name]; ok {
			return info, nil
		}
		return nil, nats.ErrConsumerNotFound
	}
	if f.existingConsumer == nil {
		return nil, nats.ErrConsumerNotFound
	}
	return f.existingConsumer, nil
}

func (f *fakeJetStream) AddConsumer(stream string, cfg *nats.ConsumerConfig, _ ...nats.JSOpt) (*nats.ConsumerInfo, error) {
	stored := *cfg
	f.addedConsumer = &stored
	f.consumerStreams = append(f.consumerStreams, stream)
	info := &nats.ConsumerInfo{Stream: stream, Name: cfg.Durable, Config: stored}
	f.existingConsumer = info

	if f.addedConsumers == nil {
		f.addedConsumers = map[string]*nats.ConsumerConfig{}
	}
	f.addedConsumers[cfg.Durable] = &stored
	if f.existingConsumers == nil {
		f.existingConsumers = map[string]*nats.ConsumerInfo{}
	}
	f.existingConsumers[cfg.Durable] = info

	return info, nil
}
