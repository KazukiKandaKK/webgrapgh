package hub

import (
	"sync"
	"testing"
	"time"
)

func TestNewHub(t *testing.T) {
	h := New()
	if h.Count() != 0 {
		t.Errorf("new hub Count() = %d, want 0", h.Count())
	}
}

func TestRegisterUnregister(t *testing.T) {
	h := New()
	c := NewClient(8)

	h.Register(c)
	if h.Count() != 1 {
		t.Errorf("after Register, Count() = %d, want 1", h.Count())
	}

	h.Unregister(c)
	if h.Count() != 0 {
		t.Errorf("after Unregister, Count() = %d, want 0", h.Count())
	}

	// Unregister twice should not panic.
	h.Unregister(c)
}

func TestBroadcast(t *testing.T) {
	h := New()
	c1 := NewClient(8)
	c2 := NewClient(8)
	h.Register(c1)
	h.Register(c2)

	payload := []byte("hello")
	h.Broadcast(payload)

	select {
	case msg := <-c1.Send():
		if string(msg) != "hello" {
			t.Errorf("c1 got %q, want %q", msg, "hello")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("c1 did not receive message")
	}

	select {
	case msg := <-c2.Send():
		if string(msg) != "hello" {
			t.Errorf("c2 got %q, want %q", msg, "hello")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("c2 did not receive message")
	}
}

func TestBroadcastExcept(t *testing.T) {
	h := New()
	sender := NewClient(8)
	receiver := NewClient(8)
	h.Register(sender)
	h.Register(receiver)

	h.BroadcastExcept([]byte("msg"), sender)

	// Sender should NOT receive the message.
	select {
	case <-sender.Send():
		t.Error("sender should not receive its own broadcast")
	case <-time.After(50 * time.Millisecond):
		// expected
	}

	// Receiver should get it.
	select {
	case msg := <-receiver.Send():
		if string(msg) != "msg" {
			t.Errorf("receiver got %q, want %q", msg, "msg")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("receiver did not receive message")
	}
}

func TestBroadcastDropsSlowClient(t *testing.T) {
	h := New()
	// Create a client with buffer size 1.
	slow := NewClient(1)
	h.Register(slow)

	// Fill the buffer.
	h.Broadcast([]byte("first"))
	// The second broadcast should overflow the buffer and drop the slow client.
	h.Broadcast([]byte("second"))

	// The slow client should be unregistered.
	// Give a tiny window for the unregister to complete.
	time.Sleep(10 * time.Millisecond)
	if h.Count() != 0 {
		t.Errorf("slow client should have been dropped, Count() = %d", h.Count())
	}

	// Client's Done channel should be closed.
	select {
	case <-slow.Done():
		// expected
	default:
		t.Error("slow client Done() channel should be closed after drop")
	}
}

func TestClientClose_Idempotent(t *testing.T) {
	c := NewClient(4)
	c.Close()
	c.Close() // should not panic

	select {
	case <-c.Done():
	default:
		t.Error("Done() should be closed after Close()")
	}
}

func TestConcurrentBroadcast(t *testing.T) {
	h := New()
	const numClients = 10
	clients := make([]*Client, numClients)
	for i := range clients {
		clients[i] = NewClient(64)
		h.Register(clients[i])
	}

	var wg sync.WaitGroup
	const numMessages = 50
	wg.Add(numMessages)
	for i := 0; i < numMessages; i++ {
		go func(i int) {
			defer wg.Done()
			h.Broadcast([]byte{byte(i)})
		}(i)
	}
	wg.Wait()

	// Each client should have received up to numMessages messages.
	// Due to concurrency some might be dropped if buffer fills, but no panics.
	for i, c := range clients {
		count := 0
		for {
			select {
			case <-c.Send():
				count++
			default:
				goto done
			}
		}
	done:
		if count == 0 {
			t.Errorf("client %d received 0 messages, expected > 0", i)
		}
	}
}
