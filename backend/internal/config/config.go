package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	PostgresHost     string
	PostgresPort     int
	PostgresUser     string
	PostgresPassword string
	PostgresDB       string
	PostgresSSLMode  string

	BackendPort         int
	SeedPointsPerMetric int
	PushHz              int
	LogPushHz           int
	AllowedOrigins      []string

	// DockerHost is the Docker Engine API endpoint used by cmd/collector.
	// Supports unix sockets ("unix:///var/run/docker.sock") and TCP
	// ("tcp://host:2375" / "http://host:2375").
	DockerHost string
	// CollectHz is how many times per second cmd/collector polls container
	// stats. Container stats are coarse (1s cgroup accounting) so 1 is plenty.
	CollectHz int
}

func Load() Config {
	return Config{
		PostgresHost:        getEnv("POSTGRES_HOST", "localhost"),
		PostgresPort:        getEnvInt("POSTGRES_PORT", 5432),
		PostgresUser:        getEnv("POSTGRES_USER", "webgraph"),
		PostgresPassword:    getEnv("POSTGRES_PASSWORD", "webgraph"),
		PostgresDB:          getEnv("POSTGRES_DB", "webgraph"),
		PostgresSSLMode:     getEnv("POSTGRES_SSLMODE", "disable"),
		BackendPort:         getEnvInt("BACKEND_PORT", 8080),
		SeedPointsPerMetric: getEnvInt("SEED_POINTS_PER_METRIC", 20000),
		PushHz:              getEnvInt("PUSH_HZ", 20),
		LogPushHz:           getEnvInt("LOG_PUSH_HZ", 30),
		AllowedOrigins:      splitCSV(getEnv("ALLOWED_ORIGINS", "http://localhost:3000")),
		DockerHost:          getEnv("DOCKER_HOST", "unix:///var/run/docker.sock"),
		CollectHz:           getEnvInt("COLLECT_HZ", 1),
	}
}

func (c Config) PostgresDSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		quoteDSN(c.PostgresHost), c.PostgresPort, quoteDSN(c.PostgresUser),
		quoteDSN(c.PostgresPassword), quoteDSN(c.PostgresDB), quoteDSN(c.PostgresSSLMode),
	)
}

// quoteDSN quotes a libpq keyword=value DSN value. Unquoted values are
// terminated by whitespace, so a value containing spaces or special chars
// must be single-quoted with internal single-quotes and backslashes escaped.
func quoteDSN(v string) string {
	if v == "" {
		return "''"
	}
	needsQuote := false
	for _, c := range v {
		if c == ' ' || c == '\'' || c == '\\' || c == '=' {
			needsQuote = true
			break
		}
	}
	if !needsQuote {
		return v
	}
	var b strings.Builder
	b.WriteByte('\'')
	for _, c := range v {
		if c == '\'' || c == '\\' {
			b.WriteByte('\\')
		}
		b.WriteRune(c)
	}
	b.WriteByte('\'')
	return b.String()
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			log.Printf("config: ignoring non-integer %s=%q (using default %d): %v", key, v, def, err)
			return def
		}
		return n
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
