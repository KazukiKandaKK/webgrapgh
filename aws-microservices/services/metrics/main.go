// Command metrics is a standalone gRPC server that produces synthetic
// time-series ticks for every known metric. It exposes:
//
//	rpc StreamRealtime — server stream of fresh Ticks at PUSH_HZ
//	rpc GetHistory     — server stream of historical Ticks (in-memory ring)
//
// The service holds no other state and never talks to a database. A producer
// goroutine generates one Tick per (1/PUSH_HZ) seconds, stores it in the
// ring, and broadcasts to every active StreamRealtime client.
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	metricspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/metrics"
	"google.golang.org/grpc"
)

type server struct {
	metricspb.UnimplementedMetricsServiceServer
	ring        *Ring
	broadcaster *Broadcaster
}

func (s *server) StreamRealtime(req *metricspb.StreamRequest, stream metricspb.MetricsService_StreamRealtimeServer) error {
	requested := req.GetMetricNames()
	filter := func(t *metricspb.Tick) *metricspb.Tick { return t }
	if len(requested) > 0 {
		set := make(map[string]struct{}, len(requested))
		for _, n := range requested {
			set[n] = struct{}{}
		}
		filter = func(t *metricspb.Tick) *metricspb.Tick {
			pruned := &metricspb.Tick{
				TimestampMs: t.TimestampMs,
				Values:      make(map[string]float64, len(set)),
			}
			for k, v := range t.Values {
				if _, ok := set[k]; ok {
					pruned.Values[k] = v
				}
			}
			return pruned
		}
	}

	ch, cancel := s.broadcaster.Subscribe(64)
	defer cancel()

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case t, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(filter(t)); err != nil {
				return err
			}
		}
	}
}

func (s *server) GetHistory(req *metricspb.HistoryRequest, stream metricspb.MetricsService_GetHistoryServer) error {
	ticks := s.ring.Snapshot(req.GetFromTimestampMs(), req.GetToTimestampMs(), int(req.GetMaxPoints()))
	requested := req.GetMetricNames()
	var keep map[string]struct{}
	if len(requested) > 0 {
		keep = make(map[string]struct{}, len(requested))
		for _, n := range requested {
			keep[n] = struct{}{}
		}
	}
	for _, t := range ticks {
		out := t
		if keep != nil {
			pruned := &metricspb.Tick{
				TimestampMs: t.TimestampMs,
				Values:      make(map[string]float64, len(keep)),
			}
			for k, v := range t.Values {
				if _, ok := keep[k]; ok {
					pruned.Values[k] = v
				}
			}
			out = pruned
		}
		if err := stream.Send(out); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	port := getEnvInt("PORT", 50051)
	pushHz := getEnvInt("PUSH_HZ", 20)
	historySize := getEnvInt("HISTORY_SIZE", 20000)
	seedMinutes := getEnvInt("SEED_MINUTES", 60)

	ring := NewRing(historySize)
	broadcaster := NewBroadcaster()
	gen := NewGenerator()

	// Pre-seed the ring with synthetic history so a fresh client's
	// GetHistory call has data to return immediately.
	if seedMinutes > 0 {
		seedRing(ring, gen, seedMinutes, historySize)
		log.Printf("metrics: pre-seeded %d historical ticks across %dm",
			historySize, seedMinutes)
	}

	ctx, cancel := signal.NotifyContext(
		context.Background(), syscall.SIGINT, syscall.SIGTERM,
	)
	defer cancel()
	go runProducer(ctx, gen, ring, broadcaster, pushHz)

	lis, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		log.Fatalf("metrics: listen: %v", err)
	}
	grpcServer := grpc.NewServer()
	metricspb.RegisterMetricsServiceServer(grpcServer, &server{ring: ring, broadcaster: broadcaster})

	log.Printf("metrics: listening on :%d (push=%dHz, history=%d)",
		port, pushHz, historySize)
	errCh := make(chan error, 1)
	go func() { errCh <- grpcServer.Serve(lis) }()

	select {
	case <-ctx.Done():
		log.Println("metrics: shutting down")
		grpcServer.GracefulStop()
	case err := <-errCh:
		if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			log.Fatalf("metrics: serve: %v", err)
		}
	}
}

func runProducer(ctx context.Context, gen *Generator, ring *Ring, br *Broadcaster, hz int) {
	if hz < 1 {
		hz = 1
	}
	tick := time.NewTicker(time.Second / time.Duration(hz))
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			t := gen.Tick(now, MetricNames)
			ring.Append(t)
			br.Publish(t)
		}
	}
}

func seedRing(ring *Ring, gen *Generator, minutes, count int) {
	end := time.Now()
	start := end.Add(-time.Duration(minutes) * time.Minute)
	step := end.Sub(start) / time.Duration(count)
	for i := 0; i < count; i++ {
		ts := start.Add(time.Duration(i) * step)
		ring.Append(gen.Tick(ts, MetricNames))
	}
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
