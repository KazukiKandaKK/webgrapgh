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

	BackendPort          int
	SeedPointsPerMetric  int
	PushHz               int
	LogPushHz            int
	AllowedOrigins       []string
}

func Load() Config {
	return Config{
		PostgresHost:        getEnv("POSTGRES_HOST", "localhost"),
		PostgresPort:        getEnvInt("POSTGRES_PORT", 5432),
		PostgresUser:        getEnv("POSTGRES_USER", "webgraph"),
		PostgresPassword:    getEnv("POSTGRES_PASSWORD", "webgraph"),
		PostgresDB:          getEnv("POSTGRES_DB", "webgraph"),
		BackendPort:         getEnvInt("BACKEND_PORT", 8080),
		SeedPointsPerMetric: getEnvInt("SEED_POINTS_PER_METRIC", 20000),
		PushHz:              getEnvInt("PUSH_HZ", 20),
		LogPushHz:           getEnvInt("LOG_PUSH_HZ", 30),
		AllowedOrigins:      splitCSV(getEnv("ALLOWED_ORIGINS", "http://localhost:3000")),
	}
}

func (c Config) PostgresDSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=disable",
		c.PostgresHost, c.PostgresPort, c.PostgresUser, c.PostgresPassword, c.PostgresDB,
	)
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
