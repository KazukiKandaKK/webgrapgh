// Command logs is a standalone gRPC server that emits synthetic log events.
// Mirrors the monolith's logs package: in-memory ring (capacity 30000),
// pre-seeded with the last hour, then a generator goroutine producing
// LOG_PUSH_HZ events per second.
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

	logspb "github.com/KazukiKandaKK/webgrapgh/aws-microservices/proto/logs"
	"google.golang.org/grpc"
)

type server struct {
	logspb.UnimplementedLogServiceServer
	ring        *Ring
	broadcaster *Broadcaster
}

func (s *server) StreamRealtime(_ *logspb.StreamRequest, stream logspb.LogService_StreamRealtimeServer) error {
	ch, cancel := s.broadcaster.Subscribe(128)
	defer cancel()
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case ev, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(ev); err != nil {
				return err
			}
		}
	}
}

func (s *server) GetHistory(_ context.Context, req *logspb.HistoryRequest) (*logspb.HistoryResponse, error) {
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 10000
	}
	return &logspb.HistoryResponse{Events: s.ring.Snapshot(limit)}, nil
}

func main() {
	port := getEnvInt("PORT", 50052)
	pushHz := getEnvInt("LOG_PUSH_HZ", 30)
	ringCap := getEnvInt("RING_SIZE", 30000)
	seedCount := getEnvInt("SEED_COUNT", 5000)

	ring := NewRing(ringCap)
	broadcaster := NewBroadcaster()
	gen := NewGenerator()

	if seedCount > 0 {
		seedRing(ring, gen, time.Hour, seedCount)
		log.Printf("logs: seeded %d events (capacity=%d)", ring.Size(), ring.Capacity())
	}

	ctx, cancel := signal.NotifyContext(
		context.Background(), syscall.SIGINT, syscall.SIGTERM,
	)
	defer cancel()
	go runProducer(ctx, gen, ring, broadcaster, pushHz)

	lis, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		log.Fatalf("logs: listen: %v", err)
	}
	grpcServer := grpc.NewServer()
	logspb.RegisterLogServiceServer(grpcServer, &server{ring: ring, broadcaster: broadcaster})

	log.Printf("logs: listening on :%d (push=%dHz)", port, pushHz)
	errCh := make(chan error, 1)
	go func() { errCh <- grpcServer.Serve(lis) }()

	select {
	case <-ctx.Done():
		log.Println("logs: shutting down")
		grpcServer.GracefulStop()
	case err := <-errCh:
		if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			log.Fatalf("logs: serve: %v", err)
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
			ev := gen.Next(now)
			ring.Append(ev)
			br.Publish(ev)
		}
	}
}

func seedRing(ring *Ring, gen *Generator, window time.Duration, count int) {
	end := time.Now()
	start := end.Add(-window)
	step := window / time.Duration(count)
	for i := 0; i < count; i++ {
		ts := start.Add(time.Duration(i) * step)
		ev := gen.Next(ts)
		ev.TimestampMs = ts.UnixMilli()
		ring.Append(ev)
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
