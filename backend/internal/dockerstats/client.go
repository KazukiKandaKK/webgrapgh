// Package dockerstats is a tiny, dependency-free Docker Engine API client used
// by cmd/collector to measure arbitrary running containers. It talks to the
// daemon over its unix socket (or a TCP endpoint) using only the standard
// library — no Docker SDK — to keep the supply chain minimal, matching the
// rest of this repository's philosophy.
package dockerstats

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client issues requests against the Docker Engine API.
type Client struct {
	http    *http.Client
	baseURL string
}

// New builds a Client for a DOCKER_HOST-style endpoint. Supported schemes:
//
//	unix:///var/run/docker.sock   (default on Linux hosts)
//	tcp://host:2375 / http://host:2375
func New(host string) (*Client, error) {
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	u, err := url.Parse(host)
	if err != nil {
		return nil, fmt.Errorf("parse DOCKER_HOST %q: %w", host, err)
	}

	switch u.Scheme {
	case "unix":
		sock := u.Path
		tr := &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", sock)
			},
		}
		// Host is irrelevant for a unix socket; use a fixed placeholder.
		return &Client{http: &http.Client{Transport: tr}, baseURL: "http://docker"}, nil
	case "tcp", "http", "https":
		scheme := "http"
		if u.Scheme == "https" {
			scheme = "https"
		}
		return &Client{http: &http.Client{}, baseURL: scheme + "://" + u.Host}, nil
	default:
		return nil, fmt.Errorf("unsupported DOCKER_HOST scheme %q", u.Scheme)
	}
}

// Container is a single entry from GET /containers/json.
type Container struct {
	ID    string   `json:"Id"`
	Names []string `json:"Names"`
	Image string   `json:"Image"`
	State string   `json:"State"`
}

// Name returns the human-friendly container name (leading slash stripped),
// falling back to a short ID when no name is present.
func (c Container) Name() string {
	if len(c.Names) > 0 {
		return strings.TrimPrefix(c.Names[0], "/")
	}
	if len(c.ID) >= 12 {
		return c.ID[:12]
	}
	return c.ID
}

// List returns all running containers.
func (c *Client) List(ctx context.Context) ([]Container, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/containers/json", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list containers: status %d", resp.StatusCode)
	}
	var out []Container
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode container list: %w", err)
	}
	return out, nil
}

// Stats fetches a single non-streaming stats reading for one container. The
// daemon collects two samples ~1s apart and returns both cpu_stats and
// precpu_stats in the response, so CPU% is computable from this one call.
func (c *Client) Stats(ctx context.Context, id string) (*StatsJSON, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/containers/"+id+"/stats?stream=false", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stats %s: status %d", id, resp.StatusCode)
	}
	var s StatsJSON
	if err := json.NewDecoder(resp.Body).Decode(&s); err != nil {
		return nil, fmt.Errorf("decode stats %s: %w", id, err)
	}
	return &s, nil
}

// timeout wraps the parent ctx with a per-request deadline. stream=false reads
// block ~1s on the daemon, so allow generous headroom.
func WithTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 8*time.Second)
}
