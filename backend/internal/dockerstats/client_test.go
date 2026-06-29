package dockerstats

import "testing"

func TestNew_Schemes(t *testing.T) {
	cases := []struct {
		host    string
		baseURL string
		wantErr bool
	}{
		{"", "http://docker", false},                            // default unix socket
		{"unix:///var/run/docker.sock", "http://docker", false}, // unix
		{"tcp://localhost:2375", "http://localhost:2375", false},
		{"http://10.0.0.1:2375", "http://10.0.0.1:2375", false},
		{"https://10.0.0.1:2376", "https://10.0.0.1:2376", false},
		{"ftp://nope", "", true},
	}
	for _, c := range cases {
		cl, err := New(c.host)
		if c.wantErr {
			if err == nil {
				t.Fatalf("New(%q): expected error", c.host)
			}
			continue
		}
		if err != nil {
			t.Fatalf("New(%q): %v", c.host, err)
		}
		if cl.baseURL != c.baseURL {
			t.Fatalf("New(%q) baseURL = %q, want %q", c.host, cl.baseURL, c.baseURL)
		}
	}
}
