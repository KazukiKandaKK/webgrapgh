package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	// Clear any env vars that might affect the test.
	keys := []string{
		"POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER",
		"POSTGRES_PASSWORD", "POSTGRES_DB", "BACKEND_PORT",
		"SEED_POINTS_PER_METRIC", "PUSH_HZ", "LOG_PUSH_HZ",
		"ALLOWED_ORIGINS",
	}
	for _, k := range keys {
		os.Unsetenv(k)
	}

	cfg := Load()

	if cfg.PostgresHost != "localhost" {
		t.Errorf("PostgresHost = %q, want %q", cfg.PostgresHost, "localhost")
	}
	if cfg.PostgresPort != 5432 {
		t.Errorf("PostgresPort = %d, want %d", cfg.PostgresPort, 5432)
	}
	if cfg.PostgresUser != "webgraph" {
		t.Errorf("PostgresUser = %q, want %q", cfg.PostgresUser, "webgraph")
	}
	if cfg.PostgresPassword != "webgraph" {
		t.Errorf("PostgresPassword = %q, want %q", cfg.PostgresPassword, "webgraph")
	}
	if cfg.PostgresDB != "webgraph" {
		t.Errorf("PostgresDB = %q, want %q", cfg.PostgresDB, "webgraph")
	}
	if cfg.BackendPort != 8080 {
		t.Errorf("BackendPort = %d, want %d", cfg.BackendPort, 8080)
	}
	if cfg.SeedPointsPerMetric != 20000 {
		t.Errorf("SeedPointsPerMetric = %d, want %d", cfg.SeedPointsPerMetric, 20000)
	}
	if cfg.PushHz != 20 {
		t.Errorf("PushHz = %d, want %d", cfg.PushHz, 20)
	}
	if cfg.LogPushHz != 30 {
		t.Errorf("LogPushHz = %d, want %d", cfg.LogPushHz, 30)
	}
	if len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "http://localhost:3000" {
		t.Errorf("AllowedOrigins = %v, want [http://localhost:3000]", cfg.AllowedOrigins)
	}
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("POSTGRES_HOST", "db.example.com")
	t.Setenv("POSTGRES_PORT", "5433")
	t.Setenv("POSTGRES_USER", "admin")
	t.Setenv("POSTGRES_PASSWORD", "secret")
	t.Setenv("POSTGRES_DB", "mydb")
	t.Setenv("BACKEND_PORT", "9090")
	t.Setenv("SEED_POINTS_PER_METRIC", "5000")
	t.Setenv("PUSH_HZ", "50")
	t.Setenv("LOG_PUSH_HZ", "60")
	t.Setenv("ALLOWED_ORIGINS", "http://localhost:3000, http://localhost:4000")

	cfg := Load()

	if cfg.PostgresHost != "db.example.com" {
		t.Errorf("PostgresHost = %q, want %q", cfg.PostgresHost, "db.example.com")
	}
	if cfg.PostgresPort != 5433 {
		t.Errorf("PostgresPort = %d, want %d", cfg.PostgresPort, 5433)
	}
	if cfg.PostgresUser != "admin" {
		t.Errorf("PostgresUser = %q, want %q", cfg.PostgresUser, "admin")
	}
	if cfg.PostgresPassword != "secret" {
		t.Errorf("PostgresPassword = %q, want %q", cfg.PostgresPassword, "secret")
	}
	if cfg.PostgresDB != "mydb" {
		t.Errorf("PostgresDB = %q, want %q", cfg.PostgresDB, "mydb")
	}
	if cfg.BackendPort != 9090 {
		t.Errorf("BackendPort = %d, want %d", cfg.BackendPort, 9090)
	}
	if cfg.SeedPointsPerMetric != 5000 {
		t.Errorf("SeedPointsPerMetric = %d, want %d", cfg.SeedPointsPerMetric, 5000)
	}
	if cfg.PushHz != 50 {
		t.Errorf("PushHz = %d, want %d", cfg.PushHz, 50)
	}
	if cfg.LogPushHz != 60 {
		t.Errorf("LogPushHz = %d, want %d", cfg.LogPushHz, 60)
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Fatalf("AllowedOrigins len = %d, want 2", len(cfg.AllowedOrigins))
	}
	if cfg.AllowedOrigins[0] != "http://localhost:3000" {
		t.Errorf("AllowedOrigins[0] = %q, want %q", cfg.AllowedOrigins[0], "http://localhost:3000")
	}
	if cfg.AllowedOrigins[1] != "http://localhost:4000" {
		t.Errorf("AllowedOrigins[1] = %q, want %q", cfg.AllowedOrigins[1], "http://localhost:4000")
	}
}

func TestPostgresDSN(t *testing.T) {
	cfg := Config{
		PostgresHost:     "myhost",
		PostgresPort:     5432,
		PostgresUser:     "user1",
		PostgresPassword: "pass1",
		PostgresDB:       "db1",
		PostgresSSLMode:  "disable",
	}
	want := "host=myhost port=5432 user=user1 password=pass1 dbname=db1 sslmode=disable"
	got := cfg.PostgresDSN()
	if got != want {
		t.Errorf("PostgresDSN() = %q, want %q", got, want)
	}
}

func TestPostgresDSN_Injection(t *testing.T) {
	cfg := Config{
		PostgresHost:     "evil sslmode=allow",
		PostgresPort:     5432,
		PostgresUser:     "user1",
		PostgresPassword: "p'ass",
		PostgresDB:       "db1",
		PostgresSSLMode:  "disable",
	}
	got := cfg.PostgresDSN()
	want := `host='evil sslmode=allow' port=5432 user=user1 password='p\'ass' dbname=db1 sslmode=disable`
	if got != want {
		t.Errorf("PostgresDSN() = %q, want %q", got, want)
	}
}

func TestQuoteDSN(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"simple", "simple"},
		{"", "''"},
		{"has space", "'has space'"},
		{"has'quote", `'has\'quote'`},
		{`back\slash`, `'back\\slash'`},
		{"key=val", "'key=val'"},
	}
	for _, tt := range tests {
		got := quoteDSN(tt.in)
		if got != tt.want {
			t.Errorf("quoteDSN(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestGetEnvInt_InvalidFallsBackToDefault(t *testing.T) {
	t.Setenv("TEST_INT_KEY", "notanumber")
	got := getEnvInt("TEST_INT_KEY", 42)
	if got != 42 {
		t.Errorf("getEnvInt with invalid value = %d, want %d", got, 42)
	}
}

func TestSplitCSV(t *testing.T) {
	tests := []struct {
		input string
		want  []string
	}{
		{"a,b,c", []string{"a", "b", "c"}},
		{" a , b , c ", []string{"a", "b", "c"}},
		{"single", []string{"single"}},
		{"", nil},
		{",,,", nil},
		{"a,,b", []string{"a", "b"}},
	}
	for _, tt := range tests {
		got := splitCSV(tt.input)
		if len(got) != len(tt.want) {
			t.Errorf("splitCSV(%q) = %v (len %d), want %v (len %d)", tt.input, got, len(got), tt.want, len(tt.want))
			continue
		}
		for i := range got {
			if got[i] != tt.want[i] {
				t.Errorf("splitCSV(%q)[%d] = %q, want %q", tt.input, i, got[i], tt.want[i])
			}
		}
	}
}
